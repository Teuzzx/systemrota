package com.rota.mobile.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import com.rota.mobile.MainActivity
import com.rota.mobile.R
import com.rota.mobile.data.repository.RouteRepository
import com.rota.mobile.domain.DistanceCalculator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Servico de localizacao em primeiro plano durante a jornada ativa.
 *
 * Restricoes do Android respeitadas:
 *  - so roda com jornada ativa (rastreamento desligado fora dela);
 *  - exige permissao de localizacao concedida;
 *  - exige notificacao persistente (exigida pelo SO);
 *  - intervalo adaptativo: mais rapido em movimento, mais lento parado;
 *  - pontos ficam na fila local e sobem por WorkManager.
 */
class LocationTrackingService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var repository: RouteRepository
    private lateinit var fusedClient: FusedLocationProviderClient

    private var journeyId: String? = null
    private var sequence = 0

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            val journey = journeyId ?: return
            sequence += 1
            scope.launch {
                repository.enqueueLocation(
                    journeyId = journey,
                    sequenceNo = sequence,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracyM = if (location.hasAccuracy()) location.accuracy else 999f,
                    capturedAt = location.time, // timestamp do DISPOSITIVO
                    speedMps = if (location.hasSpeed()) location.speed else null,
                    bearingDeg = if (location.hasBearing()) location.bearing else null,
                    batteryPct = null,
                )
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        repository = RouteRepository.get(this)
        fusedClient = com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(this)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestedJourney = intent?.getStringExtra(EXTRA_JOURNEY_ID)
        if (requestedJourney == null) {
            stopTracking()
            return START_NOT_STICKY
        }
        if (!hasLocationPermission()) {
            // Sem permissao o Android nao permite foreground de localizacao.
            stopSelf()
            return START_NOT_STICKY
        }
        journeyId = requestedJourney
        startForeground(NOTIFICATION_ID, buildNotification())
        startUpdates()
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, MOVING_INTERVAL_MS)
            .setMinUpdateIntervalMillis(STATIONARY_INTERVAL_MS)
            .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
            .setWaitForAccurateLocation(false)
            .build()
        fusedClient.requestLocationUpdates(request, callback, mainLooper)
    }

    private fun stopTracking() {
        fusedClient.removeLocationUpdates(callback)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        fusedClient.removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    private fun hasLocationPermission(): Boolean =
        ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Rastreamento de jornada",
                NotificationManager.IMPORTANCE_LOW, // sem som: nao atrapalha a direcao
            ).apply { description = "Mostrado enquanto a jornada esta ativa." }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.tracking_notification_title))
            .setContentText(getString(R.string.tracking_notification_body))
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true) // persistente enquanto durar o rastreio
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "rota_tracking"
        const val NOTIFICATION_ID = 4201
        const val EXTRA_JOURNEY_ID = "journey_id"

        /** Intervalo alvo em movimento: 15s (ajustavel apos testes reais). */
        const val MOVING_INTERVAL_MS = 15_000L

        /** Intervalo alvo parado: 60s, para economizar bateria. */
        const val STATIONARY_INTERVAL_MS = 60_000L

        const val MIN_DISTANCE_M = 10f

        fun start(context: Context, journeyId: String) {
            val intent = Intent(context, LocationTrackingService::class.java)
                .putExtra(EXTRA_JOURNEY_ID, journeyId)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationTrackingService::class.java))
        }
    }
}

/** Estimate distancia da jornada a partir da fila local. */
suspend fun repositoryDistance(repository: RouteRepository, journeyId: String): Double =
    DistanceCalculator.accumulate(
        repository.trackPoints(journeyId).map {
            DistanceCalculator.Sample(it.latitude, it.longitude, it.capturedAt, it.accuracyM)
        },
    ).distanceM
