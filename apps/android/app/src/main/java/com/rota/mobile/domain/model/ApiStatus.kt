package com.rota.mobile.domain.model

/**
 * Conversao entre os status do backend e os enums do app.
 *
 * EXISTE POR UM MOTIVO CONCRETO: a API devolve status em portugues
 * ("CONCLUIDA", "NAO_REALIZADA") e o app usava literais em ingles
 * ("CONCLUDED"). As comparacoes nunca casavam, entao os contadores de
 * "atendidos" e "restantes" ficariam sempre em zero — um defeito silencioso,
 * do tipo que so se descobre olhando a tela em producao.
 *
 * Tudo que cruza a fronteira da API passa por aqui. Nada mais compara string
 * de status diretamente.
 */

/** Status de visita como nomeado pela API (portugues, sem acento). */
object ApiVisitStatus {
    const val PLANEJADA = "PLANEJADA"
    const val EM_DESLOCAMENTO = "EM_DESLOCAMENTO"
    const val CHEGADA_REGISTRADA = "CHEGADA_REGISTRADA"
    const val EM_ATENDIMENTO = "EM_ATENDIMENTO"
    const val CONCLUIDA = "CONCLUIDA"
    const val NAO_REALIZADA = "NAO_REALIZADA"
    const val CANCELADA = "CANCELADA"

    /** Status que encerram a visita: nao contam mais como restante. */
    val ENCERRADOS = setOf(CONCLUIDA, NAO_REALIZADA, CANCELADA)

    /**
     * Converte para o enum do app. Estado desconhecido vira PLANNED, que e o
     * estado neutro — nunca uma exception, porque um status novo no backend
     * nao pode derrubar a tela do motorista.
     */
    fun paraStatus(bruto: String?): VisitStatus = when (bruto?.trim()?.uppercase()) {
        EM_DESLOCAMENTO -> VisitStatus.EN_ROUTE
        CHEGADA_REGISTRADA -> VisitStatus.ARRIVED
        EM_ATENDIMENTO -> VisitStatus.IN_SERVICE
        CONCLUIDA -> VisitStatus.CONCLUDED
        NAO_REALIZADA -> VisitStatus.NOT_DONE
        CANCELADA -> VisitStatus.CANCELLED
        PLANEJADA -> VisitStatus.PLANNED
        else -> VisitStatus.PLANNED
    }

    /** Converte do enum do app para o nome que a API espera. */
    fun doStatus(status: VisitStatus): String = when (status) {
        VisitStatus.PLANNED -> PLANEJADA
        VisitStatus.EN_ROUTE -> EM_DESLOCAMENTO
        VisitStatus.ARRIVED -> CHEGADA_REGISTRADA
        VisitStatus.IN_SERVICE -> EM_ATENDIMENTO
        VisitStatus.CONCLUDED -> CONCLUIDA
        VisitStatus.NOT_DONE -> NAO_REALIZADA
        VisitStatus.CANCELLED -> CANCELADA
    }
}

/** Mesmo cuidado para jornada. */
object ApiJourneyStatus {
    const val EM_ANDAMENTO = "EM_ANDAMENTO"
    const val PAUSADA = "PAUSADA"
    const val FINALIZADA = "FINALIZADA"
    const val CANCELADA = "CANCELADA"

    fun paraStatus(bruto: String?): JourneyStatus = when (bruto?.trim()?.uppercase()) {
        EM_ANDAMENTO -> JourneyStatus.IN_PROGRESS
        PAUSADA -> JourneyStatus.PAUSED
        FINALIZADA -> JourneyStatus.FINISHED
        CANCELADA -> JourneyStatus.CANCELLED
        else -> JourneyStatus.NOT_STARTED
    }

    fun doStatus(status: JourneyStatus): String = when (status) {
        JourneyStatus.NOT_STARTED -> "NAO_INICIADA"
        JourneyStatus.IN_PROGRESS -> EM_ANDAMENTO
        JourneyStatus.PAUSED -> PAUSADA
        JourneyStatus.FINISHED -> FINALIZADA
        JourneyStatus.CANCELLED -> CANCELADA
    }
}

/** Status de geocodificacao: a API tambem usa portugues aqui. */
object ApiGeocodeStatus {
    const val VALIDADO = "VALIDADO"
    const val PENDENTE = "PENDENTE"
    const val INVALIDO = "INVALIDO"
    const val AUSENTE = "AUSENTE"

    fun paraStatus(bruto: String?): GeocodeStatus = when (bruto?.trim()?.uppercase()) {
        VALIDADO -> GeocodeStatus.VALID
        PENDENTE -> GeocodeStatus.PENDING
        INVALIDO -> GeocodeStatus.INVALID
        else -> GeocodeStatus.MISSING
    }
}