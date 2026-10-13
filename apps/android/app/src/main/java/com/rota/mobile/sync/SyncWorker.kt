package com.rota.mobile.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.rota.mobile.data.local.SyncEventDto
import com.rota.mobile.data.local.SyncLocationDto
import com.rota.mobile.data.repository.RouteRepository
import com.rota.mobile.data.repository.toIso8601
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.TimeUnit

/**
 * Sincronizacao em segundo plano, compatível com as restrições do Android.
 *
 * Idempotencia: cada evento/ponto carrega `client*Id` gerado no dispositivo.
 * O servidor reconhece o reenvio e NÃO contabiliza duas vezes. Só removemos da
 * fila local o que o servidor confirmou (aceito OU reconhecido como duplicado).
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    private val repository = RouteRepository.get(applicationContext)
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun doWork(): Result {
        val online = repository.isOnline()
        if (!online) {
            // Sem rede: tenta de novo depois. Nada e descartado.
            return Result.retry()
        }

        return try {
            val journey = repository.activeJourney()
            if (journey == null) {
                Result.success()
            } else {
                syncEvents(journey.id)
                syncLocations(journey.id)
                Result.success()
            }
        } catch (error: Exception) {
            Result.retry()
        }
    }

    private suspend fun syncEvents(journeyId: String) {
        val pending = repository.pendingEventsFor(journeyId, BATCH_SIZE)
        if (pending.isEmpty()) return

        val payload = pending.map {
            SyncEventDto(
                clientEventId = it.clientEventId,
                journeyId = it.journeyId,
                sequenceNo = it.sequenceNo,
                type = it.type,
                capturedAt = it.capturedAt.toIso8601(),
                latitude = it.latitude,
                longitude = it.longitude,
                accuracyM = it.accuracyM,
            )
        }

        val response = RotaApi.sendEvents(applicationContext, json.encodeToString(payload))
        val confirmed = response.accepted + response.duplicates
        if (confirmed.isNotEmpty()) repository.removeSyncedEvents(confirmed)

        if (response.routeVersionConflict.detected) {
            // O admin alterou a rota enquanto o app estava offline.
            // Sinalizamos para a UI pedir a revisao ao motorista.
            SyncStateBus.routeVersionConflict.value = true
        }
    }

    private suspend fun syncLocations(journeyId: String) {
        val pending = repository.pendingLocationsFor(journeyId, LOCATION_BATCH_SIZE)
        if (pending.isEmpty()) return

        val payload = pending.map {
            SyncLocationDto(
                clientPointId = it.clientPointId,
                sequenceNo = it.sequenceNo,
                latitude = it.latitude,
                longitude = it.longitude,
                accuracyM = it.accuracyM,
                capturedAt = it.capturedAt.toIso8601(),
                speedMps = it.speedMps,
                bearingDeg = it.bearingDeg,
                connectivity = it.connectivity,
                batteryPct = it.batteryPct,
            )
        }

        val response = RotaApi.sendLocations(applicationContext, json.encodeToString(payload))
        // O contrato de localizacoes devolve CONTAGENS em accepted/duplicates
        // (number), nao os ids - diferente do de eventos, que devolve string[].
        // Somar os dois aqui produzia um Int, e `toSet()` sobre ele nao tinha
        // como casar com nenhum clientPointId: a fila local nunca esvaziaria e
        // os pontos seriam reenviados para sempre.
        //
        // Os ids que o servidor recusou voltam em `rejected`. Logo, o que NAO
        // foi rejeitado foi aceito (ou reconhecido como duplicado) e pode sair
        // da fila local.
        val rejected = response.rejected.map { it.clientPointId }.toSet()
        val toRemove = pending.map { it.clientPointId }.filterNot { it in rejected }
        if (toRemove.isNotEmpty()) repository.removeSyncedLocations(toRemove)
    }

    companion object {
        private const val BATCH_SIZE = 200
        private const val LOCATION_BATCH_SIZE = 500
        private const val PERIODIC_MINUTES = 15L
        const val UNIQUE_PERIODIC = "rota-sync-periodic"
        const val UNIQUE_IMMEDIATE = "rota-sync-now"

        /** Contexto da aplicacao, preenchido em RotaApplication. */
        @Volatile
        lateinit var appContext: Context
            private set

        internal fun init(context: Context) {
            appContext = context.applicationContext
        }

        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(PERIODIC_MINUTES, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /** Dispara envio imediato ao voltar a conexao. */
        fun syncNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_IMMEDIATE, ExistingWorkPolicy.REPLACE, request)
        }
    }
}

/** Estado global simples para sinalizar conflito de versao de rota. */
object SyncStateBus {
    val routeVersionConflict = kotlinx.coroutines.flow.MutableStateFlow(false)
}
