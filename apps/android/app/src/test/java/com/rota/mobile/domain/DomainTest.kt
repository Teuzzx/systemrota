package com.rota.mobile.domain

import com.rota.mobile.domain.model.JourneyStatus
import com.rota.mobile.domain.model.MeasurementQuality
import com.rota.mobile.domain.model.VisitStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Testes JVM (rodam sem emulador: `gradlew test`).
 * Validam as maquinas de estado, o calculo de tempos e o filtro de GPS.
 */
class JourneyStateMachineTest {

    @Test
    fun `permite iniciar, pausar, retomar e finalizar`() {
        assertTrue(JourneyStateMachine.canTransition(JourneyStatus.NOT_STARTED, JourneyStatus.IN_PROGRESS))
        assertTrue(JourneyStateMachine.canTransition(JourneyStatus.IN_PROGRESS, JourneyStatus.PAUSED))
        assertTrue(JourneyStateMachine.canTransition(JourneyStatus.PAUSED, JourneyStatus.IN_PROGRESS))
        assertTrue(JourneyStateMachine.canTransition(JourneyStatus.IN_PROGRESS, JourneyStatus.FINISHED))
    }

    @Test
    fun `nao permite iniciar jornada ja finalizada`() {
        assertThrows(DomainRuleException::class.java) {
            JourneyStateMachine.assertTransition(JourneyStatus.FINISHED, JourneyStatus.IN_PROGRESS)
        }
    }

    @Test
    fun `nao permite finalizar duas vezes`() {
        assertThrows(DomainRuleException::class.java) {
            JourneyStateMachine.assertTransition(JourneyStatus.FINISHED, JourneyStatus.FINISHED)
        }
    }

    @Test
    fun `evento corresponde a transicao`() {
        assertEquals(
            com.rota.mobile.domain.model.EventType.JOURNEY_STARTED,
            JourneyStateMachine.eventFor(JourneyStatus.NOT_STARTED, JourneyStatus.IN_PROGRESS),
        )
        assertEquals(
            com.rota.mobile.domain.model.EventType.JOURNEY_RESUMED,
            JourneyStateMachine.eventFor(JourneyStatus.PAUSED, JourneyStatus.IN_PROGRESS),
        )
        assertEquals(
            com.rota.mobile.domain.model.EventType.JOURNEY_FINISHED,
            JourneyStateMachine.eventFor(JourneyStatus.IN_PROGRESS, JourneyStatus.FINISHED),
        )
    }
}

class VisitStateMachineTest {

    @Test
    fun `permite chegada direta a partir de planejada`() {
        assertTrue(VisitStateMachine.canTransition(VisitStatus.PLANNED, VisitStatus.ARRIVED))
    }

    @Test
    fun `impede pular direto para atendimento`() {
        assertFalse(VisitStateMachine.canTransition(VisitStatus.PLANNED, VisitStatus.IN_SERVICE))
    }

    @Test
    fun `nao conclui sem os eventos minimos`() {
        assertThrows(DomainRuleException::class.java) {
            VisitStateMachine.assertTransition(
                VisitStatus.IN_SERVICE, VisitStatus.CONCLUDED, hasArrival = true, hasServiceStart = false,
            )
        }
        assertThrows(DomainRuleException::class.java) {
            VisitStateMachine.assertTransition(
                VisitStatus.IN_SERVICE, VisitStatus.CONCLUDED, hasArrival = false, hasServiceStart = true,
            )
        }
    }

    @Test
    fun `conclui com chegada e inicio registrados`() {
        VisitStateMachine.assertTransition(
            VisitStatus.IN_SERVICE, VisitStatus.CONCLUDED, hasArrival = true, hasServiceStart = true,
        )
    }

    @Test
    fun `estados terminais nao aceitam novas transicoes`() {
        for (terminal in listOf(VisitStatus.CONCLUDED, VisitStatus.NOT_DONE, VisitStatus.CANCELLED)) {
            listOf(VisitStatus.PLANNED, VisitStatus.ARRIVED, VisitStatus.IN_SERVICE).forEach { target ->
                assertFalse(VisitStateMachine.canTransition(terminal, target))
            }
        }
    }
}

class TimeCalculatorTest {

    private val base = 1_700_000_000_000L
    private fun at(seconds: Long) = base + seconds * 1000L

    @Test
    fun `atendimento e a diferenca entre inicio e fim`() {
        val span = TimeCalculator.serviceDuration(at(0), at(1200))
        assertEquals(1200, span?.seconds)
        assertEquals(MeasurementQuality.EXACT, span?.quality)
    }

    @Test
    fun `espera e a diferenca entre chegada e inicio de atendimento`() {
        assertEquals(180, TimeCalculator.waitDuration(at(0), at(180))?.seconds)
    }

    @Test
    fun `deslocamento usa a saida anterior e a chegada atual`() {
        assertEquals(720, TimeCalculator.travelDuration(at(1500), at(2220), null)?.seconds)
    }

    @Test
    fun `sem evento real o deslocamento vira estimativa`() {
        val span = TimeCalculator.travelDuration(null, null, 600)
        assertEquals(600, span?.seconds)
        assertEquals(MeasurementQuality.ESTIMATED, span?.quality)
    }

    @Test
    fun `nao aceita duracao negativa`() {
        assertNull(TimeCalculator.serviceDuration(at(1200), at(0)))
    }

    @Test
    fun `tempo total desconta pausas`() {
        assertEquals(12600, TimeCalculator.journeyTotal(at(0), at(14400), 1800)?.seconds)
    }

    @Test
    fun `linha do tempo separa atendimento espera e deslocamento`() {
        val visits = listOf(
            TimeCalculator.VisitTimes(
                1, "c1", arrivedAt = at(3600), serviceStartedAt = at(3900), serviceEndedAt = at(5100), plannedTravelS = null,
            ),
            TimeCalculator.VisitTimes(
                2, "c2", arrivedAt = at(5700), serviceStartedAt = at(5820), serviceEndedAt = at(6900), plannedTravelS = null,
            ),
        )
        val breakdown = TimeCalculator.buildBreakdown(at(0), at(7200), visits)
        assertEquals(1200 + 1080, breakdown.serviceS)
        assertEquals(300 + 120, breakdown.waitS)
        assertEquals(3600 + 600, breakdown.travelS)
        assertEquals(300, breakdown.unclassifiedS)
        assertEquals(MeasurementQuality.EXATA, breakdown.quality)
    }

    @Test
    fun `evento faltando marca a medicao como incompleta`() {
        val visits = listOf(
            TimeCalculator.VisitTimes(1, "c1", arrivedAt = at(600), serviceStartedAt = null, serviceEndedAt = null, plannedTravelS = null),
        )
        val breakdown = TimeCalculator.buildBreakdown(at(0), null, visits)
        assertEquals(MeasurementQuality.INCOMPLETA, breakdown.quality)
        assertEquals(0, breakdown.serviceS)
    }
}

class DistanceCalculatorTest {

    private val base = 1_700_000_000_000L

    @Test
    fun `acumula distancia de pontos coerentes`() {
        val samples = listOf(
            DistanceCalculator.Sample(-7.0774, -45.0236, base, 8f),
            DistanceCalculator.Sample(-7.0780, -45.0240, base + 60_000, 8f),
            DistanceCalculator.Sample(-7.0790, -45.0245, base + 120_000, 8f),
        )
        val result = DistanceCalculator.accumulate(samples)
        assertTrue(result.distanceM > 0)
        assertEquals(0, result.rejected)
    }

    @Test
    fun `descarta salto de gps em vez de somar na distancia`() {
        val samples = listOf(
            DistanceCalculator.Sample(-7.0774, -45.0236, base, 8f),
            // ~100 km em 10 segundos: impossivel para um veiculo real.
            DistanceCalculator.Sample(-6.2, -44.0, base + 10_000, 8f),
        )
        val result = DistanceCalculator.accumulate(samples)
        assertEquals(1, result.rejected)
        assertTrue(result.reasons.contains("salto_gps"))
        assertEquals(0.0, result.distanceM, 0.001)
    }

    @Test
    fun `descarta ponto com precisao insuficiente`() {
        val result = DistanceCalculator.accumulate(
            listOf(DistanceCalculator.Sample(-7.0774, -45.0236, base, 900f))
        )
        assertEquals(1, result.rejected)
        assertTrue(result.reasons.contains("precisao_insuficiente"))
    }

    @Test
    fun `movimento dentro do ruido nao infla a distancia`() {
        val samples = listOf(
            DistanceCalculator.Sample(-7.0774, -45.0236, base, 5f),
            DistanceCalculator.Sample(-7.0774, -45.0236, base + 300_000, 5f),
        )
        val result = DistanceCalculator.accumulate(samples)
        assertEquals(0.0, result.distanceM, 0.001)
    }
}
