package com.rota.mobile.domain

import com.rota.mobile.domain.model.MeasurementQuality
import kotlin.math.abs

/**
 * Calculo de tempos no dispositivo.
 *
 * Mesma regra do backend: deslocamento, espera, atendimento e parada nao
 * classificada sao grandezas distintas. Lacunas geram medicao ESTIMADA ou
 * INCOMPLETA — nunca um numero inventado.
 */
object TimeCalculator {

    data class Span(val seconds: Int, val quality: MeasurementQuality)

    data class VisitTimes(
        val sequence: Int,
        val customerId: String,
        val arrivedAt: Long?,
        val serviceStartedAt: Long?,
        val serviceEndedAt: Long?,
        val plannedTravelS: Int?,
    )

    data class Breakdown(
        val serviceS: Int = 0,
        val waitS: Int = 0,
        val travelS: Int = 0,
        val unclassifiedS: Int = 0,
        val pauseS: Int = 0,
        val totalJourneyS: Int? = null,
        val quality: MeasurementQuality = MeasurementQuality.EXACT,
    )

    /** DURAÇÃO DO ATENDIMENTO = fim - inicio. */
    fun serviceDuration(startedAt: Long?, endedAt: Long?): Span? {
        if (startedAt == null || endedAt == null) return null
        val seconds = ((endedAt - startedAt) / 1000L).toInt()
        if (seconds < 0) return null
        return Span(seconds, MeasurementQuality.EXACT)
    }

    /** TEMPO DE ESPERA = inicio do atendimento - chegada. */
    fun waitDuration(arrivedAt: Long?, serviceStartedAt: Long?): Span? {
        if (arrivedAt == null || serviceStartedAt == null) return null
        val seconds = ((serviceStartedAt - arrivedAt) / 1000L).toInt()
        if (seconds < 0) return null
        return Span(seconds, MeasurementQuality.EXACT)
    }

    /**
     * TEMPO DE DESLOCAMENTO = chegada ao proximo - saida do anterior.
     * Sem evento real, usa a estimativa do planejamento marcada como ESTIMADA.
     */
    fun travelDuration(
        previousDepartureAt: Long?,
        arrivedAt: Long?,
        plannedTravelS: Int?,
    ): Span? {
        if (previousDepartureAt != null && arrivedAt != null) {
            val seconds = ((arrivedAt - previousDepartureAt) / 1000L).toInt()
            if (seconds >= 0) return Span(seconds, MeasurementQuality.EXACT)
        }
        if (plannedTravelS != null && plannedTravelS >= 0) {
            return Span(plannedTravelS, MeasurementQuality.ESTIMATED)
        }
        return null
    }

    /** TEMPO TOTAL DA JORNADA = encerramento - inicio - pausas. */
    fun journeyTotal(startedAt: Long, endedAt: Long?, pauseTotalS: Int): Span? {
        if (endedAt == null) return null
        val seconds = ((endedAt - startedAt) / 1000L).toInt() - pauseTotalS
        return Span(maxOf(0, seconds), MeasurementQuality.EXACT)
    }

    fun buildBreakdown(
        journeyStartedAt: Long,
        journeyEndedAt: Long?,
        visits: List<VisitTimes>,
        pauseTotalS: Int = 0,
    ): Breakdown {
        var service = 0
        var wait = 0
        var travel = 0
        var unclassified = 0
        var hasEstimated = false
        var hasIncomplete = false

        var previousDeparture: Long? = null
        var cursor: Long = journeyStartedAt

        for (visit in visits.sortedBy { it.sequence }) {
            val reference = previousDeparture ?: journeyStartedAt
            // if/else explicito em vez de `?.let { } ?: flag = true`.
            // O compilador reportava "Variable expected" apontando para a
            // chamada da funcao, o que nao ajuda ninguem a descobrir o problema.
            // O comportamento e identico; o diagnostico deixa de ser enganoso.
            val travelSpan = travelDuration(reference, visit.arrivedAt, visit.plannedTravelS)
            if (travelSpan == null) {
                hasIncomplete = true
            } else {
                travel += travelSpan.seconds
                if (travelSpan.quality == MeasurementQuality.ESTIMATED) hasEstimated = true
            }

            if (visit.arrivedAt != null) {
                val waitSpan = waitDuration(visit.arrivedAt, visit.serviceStartedAt)
                if (waitSpan == null) hasIncomplete = true else wait += waitSpan.seconds
            } else {
                hasIncomplete = true
            }

            val serviceSpan = serviceDuration(visit.serviceStartedAt, visit.serviceEndedAt)
            if (serviceSpan == null) hasIncomplete = true else service += serviceSpan.seconds

            val departed = visit.serviceEndedAt
            if (departed != null) {
                previousDeparture = departed
                cursor = departed
            }
        }

        if (journeyEndedAt != null && journeyEndedAt > cursor) {
            unclassified = ((journeyEndedAt - cursor) / 1000L).toInt()
        }

        return Breakdown(
            serviceS = service,
            waitS = wait,
            travelS = travel,
            unclassifiedS = unclassified,
            pauseS = pauseTotalS,
            totalJourneyS = journeyTotal(journeyStartedAt, journeyEndedAt, pauseTotalS)?.seconds,
            quality = when {
                hasIncomplete -> MeasurementQuality.INCOMPLETE
                hasEstimated -> MeasurementQuality.ESTIMATED
                else -> MeasurementQuality.EXACT
            },
        )
    }
}

/**
 * Distancia acumulada com filtro de ruido de GPS.
 *
 * Regra dura: NUNCA somar indiscriminadamente saltos de GPS e nunca
 * apresentar o resultado como leitura de hodometro.
 */
object DistanceCalculator {

    data class Options(
        val maxAccuracyM: Float = 100f,
        val maxSpeedMps: Double = 62.5,
        val noiseThresholdM: Double = 15.0,
        val movingSpeedMps: Double = 1.4,
    )

    data class Sample(
        val latitude: Double,
        val longitude: Double,
        val capturedAt: Long,
        val accuracyM: Float,
    )

    data class Result(
        val distanceM: Double,
        val accepted: Int,
        val rejected: Int,
        val reasons: List<String>,
    )

    private const val EARTH_RADIUS_M = 6_371_008.8

    fun haversineM(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
        val dLat = Math.toRadians(bLat - aLat)
        val dLng = Math.toRadians(bLng - aLng)
        val lat1 = Math.toRadians(aLat)
        val lat2 = Math.toRadians(bLat)
        val h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
        return 2 * EARTH_RADIUS_M * Math.asin(minOf(1.0, Math.sqrt(h)))
    }

    fun accumulate(samples: List<Sample>, options: Options = Options()): Result {
        if (samples.isEmpty()) return Result(0.0, 0, 0, emptyList())

        var distance = 0.0
        var accepted = 0
        var rejected = 0
        val reasons = mutableListOf<String>()
        var previous: Sample? = null

        for (sample in samples.sortedBy { it.capturedAt }) {
            if (sample.accuracyM <= 0f || sample.accuracyM > options.maxAccuracyM) {
                rejected++; reasons.add("precisao_insuficiente"); continue
            }
            val prev = previous
            if (prev == null) {
                accepted++; previous = sample; continue
            }
            val dtS = (sample.capturedAt - prev.capturedAt) / 1000.0
            if (dtS <= 0) {
                rejected++; reasons.add("timestamp_invalido"); continue
            }
            val segment = haversineM(prev.latitude, prev.longitude, sample.latitude, sample.longitude)
            if (segment / dtS > options.maxSpeedMps) {
                rejected++; reasons.add("salto_gps"); continue
            }
            if (segment >= options.noiseThresholdM) distance += segment
            accepted++
            previous = sample
        }
        return Result(distance, accepted, rejected, reasons)
    }

    /** Formata km com 1 casa, em pt-BR. */
    fun formatKm(meters: Double): String {
        val km = abs(meters) / 1000.0
        return String.format(java.util.Locale("pt", "BR"), "%.1f km", km)
    }
}
