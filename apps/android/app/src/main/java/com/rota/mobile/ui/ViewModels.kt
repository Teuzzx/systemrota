package com.rota.mobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rota.mobile.data.repository.RouteRepository
import com.rota.mobile.data.repository.SyncStatus
import com.rota.mobile.domain.DomainRuleException
import com.rota.mobile.domain.JourneyStateMachine
import com.rota.mobile.domain.VisitEventType
import com.rota.mobile.domain.VisitStateMachine
import com.rota.mobile.domain.model.EventType
import com.rota.mobile.domain.model.JourneyStatus
import com.rota.mobile.location.LocationTrackingService
import com.rota.mobile.sync.SyncWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate

/**
 * Estado da tela inicial. Objeto unico de verdade para a UI.
 */
data class HomeUiState(
    val driverName: String = "",
    val today: String = "",
    val journeyStatus: JourneyStatus = JourneyStatus.NOT_STARTED,
    val routeCode: String? = null,
    val routeName: String? = null,
    val stopsPlanned: Int = 0,
    val stopsConcluded: Int = 0,
    val stopsRemaining: Int = 0,
    val distanceM: Double = 0.0,
    val elapsedSeconds: Int = 0,
    val nextCustomer: String? = null,
    val sync: SyncStatus = SyncStatus(0, 0, null, false),
    val locationGranted: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val loading: Boolean = false,
)

class HomeViewModel(
    private val repository: RouteRepository,
    private val driverName: String = "Motorista",
) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(
                driverName = driverName,
                today = LocalDate.now().toString(),
                loading = true,
                sync = repository.syncStatus(),
            )
            val journey = repository.activeJourney()
            val stops = journey?.routeId?.let { repository.customersOf(it) }.orEmpty()
            _state.value = _state.value.copy(
                journeyStatus = journey?.let {
                    runCatching { JourneyStatus.valueOf(it.status) }.getOrDefault(JourneyStatus.NOT_STARTED)
                } ?: JourneyStatus.NOT_STARTED,
                routeCode = journey?.routeId?.let { repository.route(it)?.code },
                stopsPlanned = stops.size,
                stopsConcluded = stops.count { it.visitStatus == "CONCLUDED" },
                stopsRemaining = stops.count {
                    it.visitStatus !in setOf("CONCLUDED", "NOT_DONE", "CANCELLED")
                },
                distanceM = journey?.let {
                    com.rota.mobile.location.repositoryDistance(repository, it.id)
                } ?: 0.0,
                sync = repository.syncStatus(),
                loading = false,
            )
        }
    }

    fun onLocationPermissionResult(granted: Boolean) {
        _state.value = _state.value.copy(locationGranted = granted)
        if (!granted) {
            _state.value = _state.value.copy(
                message = "Sem permissao de localizacao, o rastreamento nao funciona. " +
                    "O registro de visitas continua disponivel.",
            )
        }
    }

    /** TELA 2, botao principal: iniciar jornada. */
    fun startJourney(journeyId: String, routeId: String?, routeVersion: Int?) {
        viewModelScope.launch {
            try {
                JourneyStateMachine.assertTransition(
                    _state.value.journeyStatus, JourneyStatus.IN_PROGRESS,
                )
                repository.enqueueEvent(
                    journeyId = journeyId,
                    sequenceNo = 0,
                    type = EventType.JOURNEY_STARTED.name,
                    capturedAt = System.currentTimeMillis(),
                )
                repository.saveJourney(
                    com.rota.mobile.data.local.JourneyEntity(
                        id = journeyId,
                        driverId = driverName,
                        routeId = routeId,
                        routeVersionAtStart = routeVersion,
                        status = JourneyStatus.IN_PROGRESS.name,
                        startedAt = System.currentTimeMillis(),
                        endedAt = null,
                        pauseTotalS = 0,
                    ),
                )
                _state.value = _state.value.copy(journeyStatus = JourneyStatus.IN_PROGRESS, error = null)
                SyncWorker.syncNow(appContext())
            } catch (error: DomainRuleException) {
                _state.value = _state.value.copy(error = error.message)
            }
        }
    }

    fun pauseJourney(journeyId: String) = transitionJourney(journeyId, JourneyStatus.PAUSED)

    fun resumeJourney(journeyId: String) = transitionJourney(journeyId, JourneyStatus.IN_PROGRESS)

    fun finishJourney(journeyId: String) = transitionJourney(journeyId, JourneyStatus.FINISHED)

    private fun transitionJourney(journeyId: String, target: JourneyStatus) {
        viewModelScope.launch {
            val current = _state.value.journeyStatus
            try {
                JourneyStateMachine.assertTransition(current, target)
                val event = JourneyStateMachine.eventFor(current, target)
                repository.enqueueEvent(
                    journeyId = journeyId,
                    sequenceNo = sequenceOf(_state.value),
                    type = event.name,
                    capturedAt = System.currentTimeMillis(),
                )
                _state.value = _state.value.copy(journeyStatus = target, error = null)
                SyncWorker.syncNow(appContext())
            } catch (error: DomainRuleException) {
                _state.value = _state.value.copy(error = "${error.code}: ${error.message}")
            }
        }
    }

    private fun sequenceOf(state: HomeUiState): Int =
        state.stopsConcluded + state.stopsRemaining + 1

    private fun appContext() = SyncWorker.appContext

    fun clearMessage() {
        _state.value = _state.value.copy(message = null, error = null)
    }
}

/** ViewModel da lista de visitas. */
data class RouteUiState(
    val routeCode: String = "",
    val stops: List<com.rota.mobile.data.local.CustomerEntity> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

class MyRouteViewModel(private val repository: RouteRepository) : ViewModel() {
    private val _state = MutableStateFlow(RouteUiState())
    val state: StateFlow<RouteUiState> = _state.asStateFlow()

    fun load(routeId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            val route = repository.route(routeId)
            _state.value = RouteUiState(
                routeCode = route?.code ?: "--",
                stops = repository.customersOf(routeId),
                loading = false,
            )
        }
    }

    /**
     * Registra chegada/inicio/fim com validacao local imediata.
     * O evento vai para a fila; a UI nao espera a rede.
     */
    fun registerVisit(
        journeyId: String,
        routeId: String,
        customer: com.rota.mobile.data.local.CustomerEntity,
        type: VisitEventType,
    ) {
        viewModelScope.launch {
            try {
                val current = runCatching {
                    VisitStatus.valueOf(customer.visitStatus)
                }.getOrDefault(com.rota.mobile.domain.model.VisitStatus.PLANNED)
                val hasArrival = customer.arrivedAt != null
                val hasServiceStart = customer.serviceStartedAt != null
                VisitStateMachine.assertTransition(current, VisitStateMachine.statusFor(type), hasArrival, hasServiceStart)
                val now = System.currentTimeMillis()
                repository.enqueueEvent(
                    journeyId = journeyId,
                    sequenceNo = customer.sequence,
                    type = VisitStateMachine.eventFor(type).name,
                    capturedAt = now,
                    payload = mapOf("customerId" to customer.id),
                )
                repository.markVisitStatus(routeId, customer.id, VisitStateMachine.statusFor(type).name, now)
                load(routeId)
                SyncWorker.syncNow(SyncWorker.appContext)
            } catch (error: DomainRuleException) {
                _state.value = _state.value.copy(error = "${error.code}: ${error.message}")
            }
        }
    }
}
