package com.rota.mobile.domain.model

/**
 * Estados de jornada. Espelham a maquina de estados do backend
 * (@rota/shared): o app e um cliente da regra, nunca uma segunda regra.
 */
enum class JourneyStatus { NOT_STARTED, IN_PROGRESS, PAUSED, FINISHED, CANCELLED }

/** Estados de visita. */
enum class VisitStatus {
    PLANNUED, EN_ROUTE, ARRIVED, IN_SERVICE, CONCLUDED, NOT_DONE, CANCELLED
}

enum class EventType {
    JOURNEY_STARTED, JOURNEY_PAUSED, JOURNEY_RESUMED, JOURNEY_FINISHED, JOURNEY_CANCELLED,
    VISIT_ARRIVED, VISIT_SERVICE_STARTED, VISIT_SERVICE_ENDED,
    VISIT_NOT_DONE, VISIT_CANCELLED, OCCURRENCE_LOGGED
}

enum class ConnectivityState { ONLINE, OFFLINE, DEGRADED }

enum class GeocodeStatus { VALID, PENDING, INVALID, MISSING }

/** Motivo de visita nao realizada. */
enum class NotDoneReason {
    ESTABLISHMENT_CLOSED, CLIENT_UNAVAILABLE, WRONG_ADDRESS, ACCESS_PROBLEM, OPERATIONAL_PROBLEM, OTHER
}

/** Qualidade da medicao de tempo: nunca escondemos uma medicao parcial. */
enum class MeasurementQuality { EXACT, ESTIMATED, INCOMPLETE }

data class LatLon(val latitude: Double, val longitude: Double)

data class Customer(
    val id: String,
    val externalId: String?,
    val tradeName: String,
    val contactName: String?,
    val phone: String?,
    val addressLine: String?,
    val neighborhood: String?,
    val city: String,
    val latitude: Double?,
    val longitude: Double?,
    val geocodeStatus: GeocodeStatus,
    val sequence: Int,
    val plannedArrivalAt: Long?,
    val estTravelFromPrevS: Int?,
    val estDistanceFromPrevM: Double?,
    val visitStatus: VisitStatus,
    val arrivedAt: Long?,
    val serviceStartedAt: Long?,
    val serviceEndedAt: Long?,
    val notDoneReason: NotDoneReason?,
    val notDoneNote: String?,
)

data class Route(
    val id: String,
    val code: String,
    val name: String,
    val version: Int,
    val plannedDate: String,
    val stops: List<Customer>,
)

data class Journey(
    val id: String,
    val driverId: String,
    val routeId: String?,
    val routeVersionAtStart: Int?,
    val status: JourneyStatus,
    val startedAt: Long,
    val endedAt: Long? = null,
    val pauseTotalS: Int = 0,
)

data class LocationPoint(
    val clientPointId: String,
    val journeyId: String,
    val sequenceNo: Int,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Float,
    val speedMps: Float?,
    val bearingDeg: Float?,
    val connectivity: ConnectivityState,
    val batteryPct: Int?,
    /** Timestamp do DISPOSITIVO (captura). O servidor registra o recebimento. */
    val capturedAt: Long,
    val synced: Boolean = false,
)
