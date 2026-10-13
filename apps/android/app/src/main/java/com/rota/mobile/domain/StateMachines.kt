package com.rota.mobile.domain

import com.rota.mobile.domain.model.EventType
import com.rota.mobile.domain.model.JourneyStatus
import com.rota.mobile.domain.model.VisitStatus

/** Erro de regra de negocio, com codigo estavel para auditoria. */
class DomainRuleException(val code: String, message: String) : IllegalStateException(message)

/**
 * Maquina de estados da jornada no app.
 *
 * O app valida localmente para dar resposta imediata ao motorista, mas a
 * verdade continua sendo o backend: a API rejeita transicoes invalidas com
 * 409 e o app apenas reflete isso.
 */
object JourneyStateMachine {

    private val transitions: Map<JourneyStatus, Set<JourneyStatus>> = mapOf(
        JourneyStatus.NOT_STARTED to setOf(JourneyStatus.IN_PROGRESS, JourneyStatus.CANCELLED),
        JourneyStatus.IN_PROGRESS to setOf(
            JourneyStatus.PAUSED, JourneyStatus.FINISHED, JourneyStatus.CANCELLED
        ),
        JourneyStatus.PAUSED to setOf(
            JourneyStatus.IN_PROGRESS, JourneyStatus.FINISHED, JourneyStatus.CANCELLED
        ),
        JourneyStatus.FINISHED to emptySet(),
        JourneyStatus.CANCELLED to emptySet(),
    )

    fun canTransition(from: JourneyStatus, to: JourneyStatus): Boolean =
        transitions[from]?.contains(to) == true

    fun assertTransition(from: JourneyStatus, to: JourneyStatus) {
        if (from == to) {
            throw DomainRuleException(
                "JOURNEY_ALREADY_IN_STATE",
                "A jornada ja esta em $to. Evento repetido registrado como duplicado.",
            )
        }
        if (!canTransition(from, to)) {
            throw DomainRuleException(
                "JOURNEY_INVALID_TRANSITION",
                "Transicao de jornada invalida: $from -> $to.",
            )
        }
    }

    fun eventFor(from: JourneyStatus, to: JourneyStatus): EventType = when (to) {
        JourneyStatus.IN_PROGRESS ->
            if (from == JourneyStatus.PAUSED) EventType.JOURNEY_RESUMED else EventType.JOURNEY_STARTED
        JourneyStatus.PAUSED -> EventType.JOURNEY_PAUSED
        JourneyStatus.FINISHED -> EventType.JOURNEY_FINISHED
        JourneyStatus.CANCELLED -> EventType.JOURNEY_CANCELLED
        JourneyStatus.NOT_STARTED -> throw DomainRuleException(
            "JOURNEY_INVALID_TRANSITION", "Nao ha transicao para NOT_STARTED.",
        )
    }
}

/**
 * Maquina de estados da visita.
 *
 * Chegada e inicio de atendimento sao eventos DISTINTOS: a chegada pode
 * ocorrer antes, enquanto o motorista aguarda o responsavel.
 */
object VisitStateMachine {

    private val transitions: Map<VisitStatus, Set<VisitStatus>> = mapOf(
        VisitStatus.PLANNED to setOf(
            VisitStatus.EN_ROUTE, VisitStatus.ARRIVED, VisitStatus.NOT_DONE, VisitStatus.CANCELLED
        ),
        VisitStatus.EN_ROUTE to setOf(
            VisitStatus.ARRIVED, VisitStatus.NOT_DONE, VisitStatus.CANCELLED
        ),
        VisitStatus.ARRIVED to setOf(VisitStatus.IN_SERVICE, VisitStatus.NOT_DONE),
        VisitStatus.IN_SERVICE to setOf(VisitStatus.CONCLUDED, VisitStatus.NOT_DONE),
        VisitStatus.CONCLUDED to emptySet(),
        VisitStatus.NOT_DONE to emptySet(),
        VisitStatus.CANCELLED to emptySet(),
    )

    fun canTransition(from: VisitStatus, to: VisitStatus): Boolean =
        transitions[from]?.contains(to) == true

    /**
     * @param hasArrival ja existe chegada registrada
     * @param hasServiceStart ja existe inicio de atendimento
     * @param requireServiceBeforeConclusion regra configuravel (padrao: exige
     *        chegada E inicio para concluir)
     */
    fun assertTransition(
        from: VisitStatus,
        to: VisitStatus,
        hasArrival: Boolean,
        hasServiceStart: Boolean,
        requireServiceBeforeConclusion: Boolean = true,
    ) {
        if (from == to) {
            throw DomainRuleException(
                "VISIT_ALREADY_IN_STATE",
                "A visita ja esta em $to. Evento repetido registrado como duplicado.",
            )
        }
        if (!canTransition(from, to)) {
            throw DomainRuleException(
                "VISIT_INVALID_TRANSITION",
                "Transicao de visita invalida: $from -> $to.",
            )
        }
        if (to == VisitStatus.CONCLUDED && requireServiceBeforeConclusion) {
            if (!hasArrival) {
                throw DomainRuleException(
                    "VISIT_MISSING_ARRIVAL",
                    "Nao e possivel concluir sem horario de chegada registrado.",
                )
            }
            if (!hasServiceStart) {
                throw DomainRuleException(
                    "VISIT_MISSING_SERVICE_START",
                    "Nao e possivel concluir sem inicio de atendimento registrado.",
                )
            }
        }
        if (to == VisitStatus.IN_SERVICE && !hasArrival) {
            throw DomainRuleException(
                "VISIT_MISSING_ARRIVAL",
                "Chegada deve ser registrada antes do inicio do atendimento.",
            )
        }
    }

    fun eventFor(type: VisitEventType): EventType = when (type) {
        VisitEventType.ARRIVED -> EventType.VISIT_ARRIVED
        VisitEventType.SERVICE_STARTED -> EventType.VISIT_SERVICE_STARTED
        VisitEventType.SERVICE_ENDED -> EventType.VISIT_SERVICE_ENDED
        VisitEventType.NOT_DONE -> EventType.VISIT_NOT_DONE
        VisitEventType.CANCELLED -> EventType.VISIT_CANCELLED
    }

    fun statusFor(type: VisitEventType): VisitStatus = when (type) {
        VisitEventType.ARRIVED -> VisitStatus.ARRIVED
        VisitEventType.SERVICE_STARTED -> VisitStatus.IN_SERVICE
        VisitEventType.SERVICE_ENDED -> VisitStatus.CONCLUDED
        VisitEventType.NOT_DONE -> VisitStatus.NOT_DONE
        VisitEventType.CANCELLED -> VisitStatus.CANCELLED
    }
}

enum class VisitEventType { ARRIVED, SERVICE_STARTED, SERVICE_ENDED, NOT_DONE, CANCELLED }
