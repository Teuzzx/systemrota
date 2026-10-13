package com.rota.mobile.data.repository

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.room.Room
import com.rota.mobile.data.local.CustomerEntity
import com.rota.mobile.data.local.JourneyEntity
import com.rota.mobile.data.local.PendingEventEntity
import com.rota.mobile.data.local.PendingLocationEntity
import com.rota.mobile.data.local.RouteEntity
import com.rota.mobile.data.local.RotaDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Repositorio com estrategia offline-first.
 *
 * O app NUNCA depende da rede para registrar um evento: grava localmente
 * (Room) e a sincronizacao acontece depois, com idempotencia por
 * `clientEventId`. Se a rede cair no meio do envio, nada e duplicado.
 */
class RouteRepository private constructor(private val appContext: Context) {

    private val db: RotaDatabase = Room.databaseBuilder(appContext, RotaDatabase::class.java, RotaDatabase.NAME)
        .fallbackToDestructiveMigration()
        .build()

    private val connectivity: ConnectivityManager? =
        appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    // ------------------------------ Fila local ----------------------------

    /**
     * Enfileira um evento operacional.
     * @return true se enfileirado; false se ja existia (evento duplicado).
     */
    suspend fun enqueueEvent(
        journeyId: String,
        sequenceNo: Int,
        type: String,
        capturedAt: Long,
        payload: Map<String, String>? = null,
        latitude: Double? = null,
        longitude: Double? = null,
        accuracyM: Float? = null,
    ): Boolean = withContext(Dispatchers.IO) {
        val entity = PendingEventEntity(
            clientEventId = UUID.randomUUID().toString(),
            journeyId = journeyId,
            sequenceNo = sequenceNo,
            type = type,
            capturedAt = capturedAt,
            payloadJson = payload?.entries?.joinToString(";") { "${it.key}=${it.value}" },
            latitude = latitude,
            longitude = longitude,
            accuracyM = accuracyM,
            createdAt = System.currentTimeMillis(),
        )
        // IGNORE: reentrada do mesmo evento nao cria duplicidade na fila.
        val inserted = db.pendingEventDao().insert(entity) != -1L
        inserted
    }

    suspend fun enqueueLocation(
        journeyId: String,
        sequenceNo: Int,
        latitude: Double,
        longitude: Double,
        accuracyM: Float,
        capturedAt: Long,
        speedMps: Float?,
        bearingDeg: Float?,
        batteryPct: Int?,
        retentionDays: Int = 90,
    ): Boolean = withContext(Dispatchers.IO) {
        val entity = PendingLocationEntity(
            clientPointId = UUID.randomUUID().toString(),
            journeyId = journeyId,
            sequenceNo = sequenceNo,
            latitude = latitude,
            longitude = longitude,
            accuracyM = accuracyM,
            speedMps = speedMps,
            bearingDeg = bearingDeg,
            connectivity = currentConnectivity(),
            batteryPct = batteryPct,
            capturedAt = capturedAt,
            retainedUntil = capturedAt + retentionDays * 86_400_000L,
        )
        db.pendingLocationDao().insertAll(listOf(entity)) > 0
    }

    suspend fun pendingEventCount(): Int = withContext(Dispatchers.IO) { db.pendingEventDao().count() }

    suspend fun pendingLocationCount(): Int = withContext(Dispatchers.IO) { db.pendingLocationDao().count() }

    /** Lote de eventos prontos para envio. */
    suspend fun pendingEventsFor(journeyId: String, limit: Int): List<PendingEventEntity> =
        withContext(Dispatchers.IO) { db.pendingEventDao().pendingForJourney(journeyId, limit) }

    suspend fun pendingLocationsFor(journeyId: String, limit: Int): List<PendingLocationEntity> =
        withContext(Dispatchers.IO) { db.pendingLocationDao().pendingForJourney(journeyId, limit) }

    /** Remove somente o que o servidor confirmou (aceito ou duplicado). */
    suspend fun removeSyncedEvents(ids: List<String>) = withContext(Dispatchers.IO) {
        db.pendingEventDao().deleteAll(ids)
    }

    suspend fun removeSyncedLocations(ids: List<String>) = withContext(Dispatchers.IO) {
        db.pendingLocationDao().deleteAll(ids)
    }

    /** Trajeto capturado localmente (base do calculo de distancia offline). */
    suspend fun trackPoints(journeyId: String): List<PendingLocationEntity> =
        withContext(Dispatchers.IO) { db.pendingLocationDao().allForJourney(journeyId) }

    suspend fun oldestPendingEventAt(): Long? = withContext(Dispatchers.IO) {
        db.pendingEventDao().oldestCapturedAt()
    }

    /** Chamado pela UI para mostrar "N eventos aguardando envio". */
    suspend fun syncStatus(): SyncStatus = withContext(Dispatchers.IO) {
        val events = db.pendingEventDao().count()
        val points = db.pendingLocationDao().count()
        val oldest = db.pendingEventDao().oldestCapturedAt()
        SyncStatus(
            pendingEvents = events,
            pendingLocations = points,
            oldestPendingAt = oldest,
            online = isOnline(),
        )
    }

    // ------------------------------ Rotas ---------------------------------

    suspend fun saveRoute(route: RouteEntity, customers: List<CustomerEntity>) =
        withContext(Dispatchers.IO) {
            db.routeDao().upsert(route)
            db.customerDao().upsertAll(customers)
        }

    suspend fun route(routeId: String): RouteEntity? = withContext(Dispatchers.IO) { db.routeDao().route(routeId) }

    suspend fun customersOf(routeId: String): List<CustomerEntity> =
        withContext(Dispatchers.IO) { db.customerDao().byRoute(routeId) }

    suspend fun markVisitStatus(
        routeId: String, customerId: String, status: String, timestamp: Long,
    ) = withContext(Dispatchers.IO) {
        when (status) {
            "ARRIVED" -> db.customerDao().markArrived(routeId, customerId, status, timestamp)
            "IN_SERVICE" -> db.customerDao().markServiceStarted(routeId, customerId, status, timestamp)
            else -> db.customerDao().markFinished(routeId, customerId, status, timestamp, null, null)
        }
    }

    // ------------------------------ Jornadas ------------------------------

    suspend fun saveJourney(journey: JourneyEntity) = withContext(Dispatchers.IO) {
        db.journeyDao().upsert(journey)
    }

    suspend fun activeJourney(): JourneyEntity? = withContext(Dispatchers.IO) { db.journeyDao().active() }

    suspend fun journeyHistory(driverId: String): List<JourneyEntity> =
        withContext(Dispatchers.IO) { db.journeyDao().history(driverId) }

    // ------------------------------ Conectividade -------------------------

    fun isOnline(): Boolean {
        val manager = connectivity ?: return false
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun currentConnectivity(): String =
        if (isOnline()) "ONLINE" else "OFFLINE"

    companion object {
        @Volatile
        private var instance: RouteRepository? = null

        fun get(context: Context): RouteRepository =
            instance ?: synchronized(this) {
                instance ?: RouteRepository(context.applicationContext).also { instance = it }
            }
    }
}

data class SyncStatus(
    val pendingEvents: Int,
    val pendingLocations: Int,
    val oldestPendingAt: Long?,
    val online: Boolean,
) {
    val total: Int get() = pendingEvents + pendingLocations
}

/** Formata epoch millis para ISO-8601 UTC, como a API espera. */
fun Long.toIso8601(): String =
    DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(this))

fun String.toEpochMillis(): Long = Instant.parse(this).toEpochMilli()
