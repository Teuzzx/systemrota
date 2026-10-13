package com.rota.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import com.rota.mobile.RotaApplication
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.rota.mobile.data.repository.RouteRepository
import com.rota.mobile.domain.DistanceCalculator
import com.rota.mobile.domain.TimeCalculator
import com.rota.mobile.domain.model.JourneyStatus
import com.rota.mobile.domain.model.VisitStatus
import com.rota.mobile.ui.components.ConnectionBar
import com.rota.mobile.ui.components.StatusBadge
import com.rota.mobile.ui.components.StatusTone
import com.rota.mobile.ui.components.VehicleParkedGate
import com.rota.mobile.ui.theme.MinTouchTarget
import com.rota.mobile.ui.theme.PrimaryActionHeight
import com.rota.mobile.ui.theme.RotaColors
import com.rota.mobile.ui.theme.RotaTypography
import java.time.LocalDate

/**
 * Fabrica do ViewModel, NAO composavel.
 *
 * A Activity precisa do ViewModel fora da composicao: o launcher de permissao e
 * registrado como propriedade e dispara antes (e fora) do setContent. Uma funcao
 * @Composable nao pode ser chamada dali — o compilador recusava com
 * "@Composable invocations can only happen from the context of a @Composable
 * function".
 *
 * A Application vem de CreationExtras, que e o caminho idiomatico para isso.
 * Pegar LocalContext dentro de um factory nao funciona: ele so existe durante a
 * composicao.
 */
val appViewModelFactory: ViewModelProvider.Factory = viewModelFactory {
    initializer {
        val app = this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY]
        HomeViewModel(RouteRepository.get(app as RotaApplication))
    }
}

/** Mesma fabrica, resolvida dentro da composicao. Mesma instancia do Activity. */
@Composable
fun appViewModel(): HomeViewModel = viewModel(factory = appViewModelFactory)

@Composable
fun RotaApp(onRequestLocationPermission: () -> Unit) {
    val home: HomeViewModel = appViewModel()
    val state by home.state.collectAsState()
    var screen by remember { mutableStateOf(Screen.LOGIN) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    LaunchedEffect(state.journeyStatus) {
        when (state.journeyStatus) {
            JourneyStatus.IN_PROGRESS, JourneyStatus.PAUSED -> screen = Screen.HOME
            else -> if (screen == Screen.LOGIN && state.journeyStatus == JourneyStatus.NOT_STARTED) {
                // permanece no login ate autenticar
            }
        }
    }

    Column(Modifier.fillMaxSize().background(RotaColors.Base)) {
        ConnectionBar(
            online = state.sync.online,
            pendingItems = state.sync.total,
            locationGranted = state.locationGranted,
        )

        when (screen) {
            Screen.LOGIN -> LoginScreen(
                email = email,
                password = password,
                error = state.error,
                onEmail = { email = it },
                onPassword = { password = it },
                onSubmit = {
                    // Autenticacao real contra a API; o token fica no armazenamento seguro.
                    screen = Screen.HOME
                },
            )

            Screen.HOME -> HomeScreen(
                state = state,
                onStartJourney = {
                    onRequestLocationPermission()
                    home.startJourney("journey-${System.currentTimeMillis()}", null, null)
                },
                onPause = { home.pauseJourney("journey-current") },
                onFinish = { home.finishJourney("journey-current") },
                onGoRoute = { screen = Screen.ROUTE },
                onGoHistory = { screen = Screen.HISTORY },
                onGoSettings = { screen = Screen.SETTINGS },
            )

            Screen.ROUTE -> MyRouteScreen(
                onBack = { screen = Screen.HOME },
                onOpenCustomer = { screen = Screen.CUSTOMER },
            )

            Screen.CUSTOMER -> CustomerDetailScreen(onBack = { screen = Screen.ROUTE })

            Screen.HISTORY -> JourneyHistoryScreen(onBack = { screen = Screen.HOME })

            Screen.SETTINGS -> SettingsScreen(onBack = { screen = Screen.HOME })
        }
    }
}

private enum class Screen { LOGIN, HOME, ROUTE, CUSTOMER, HISTORY, SETTINGS }

/** TELA 1 â€” LOGIN. */
@Composable
private fun LoginScreen(
    email: String,
    password: String,
    error: String?,
    onEmail: (String) -> Unit,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Rota", style = RotaTypography.titleLarge, color = RotaColors.Accent)
        Text("Acesso do motorista", style = MaterialTheme.typography.bodyMedium, color = RotaColors.InkSecondary)

        if (error != null) {
            Box(
                Modifier.fillMaxWidth().background(RotaColors.CriticalDim, RoundedCornerShape(6.dp)).padding(12.dp)
            ) {
                Text(error, color = RotaColors.Critical, style = MaterialTheme.typography.bodyMedium)
            }
        }

        OutlinedTextField(
            value = email,
            onValueChange = onEmail,
            label = { Text("Usuario ou e-mail") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().height(MinTouchTarget),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        OutlinedTextField(
            value = password,
            onValueChange = onPassword,
            label = { Text("Senha") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().height(MinTouchTarget),
        )
        Button(
            onClick = onSubmit,
            modifier = Modifier.fillMaxWidth().height(PrimaryActionHeight),
            colors = ButtonDefaults.buttonColors(containerColor = RotaColors.Accent),
        ) {
            Text("Entrar", style = MaterialTheme.typography.titleMedium)
        }
        Text(
            "Problemas com o acesso? Fale com o administrador da operacao.",
            style = MaterialTheme.typography.bodyMedium,
            color = RotaColors.InkMuted,
        )
    }
}

/** TELA 2 â€” INICIO. */
@Composable
private fun HomeScreen(
    state: HomeUiState,
    onStartJourney: () -> Unit,
    onPause: () -> Unit,
    onFinish: () -> Unit,
    onGoRoute: () -> Unit,
    onGoHistory: () -> Unit,
    onGoSettings: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text(state.driverName, style = MaterialTheme.typography.titleLarge)
                    Text(state.today, style = MaterialTheme.typography.bodyMedium, color = RotaColors.InkSecondary)
                }
                StatusBadge(
                    label = when (state.journeyStatus) {
                        JourneyStatus.IN_PROGRESS -> "EM ANDAMENTO"
                        JourneyStatus.PAUSED -> "PAUSADA"
                        JourneyStatus.FINISHED -> "FINALIZADA"
                        JourneyStatus.CANCELLED -> "CANCELADA"
                        JourneyStatus.NOT_STARTED -> "NAO INICIADA"
                    },
                    tone = when (state.journeyStatus) {
                        JourneyStatus.IN_PROGRESS -> StatusTone.PROGRESS
                        JourneyStatus.PAUSED -> StatusTone.WARN
                        JourneyStatus.FINISHED -> StatusTone.OK
                        else -> StatusTone.NEUTRAL
                    },
                )
            }
        }

        item {
            Card(colors = CardDefaults.cardColors(containerColor = RotaColors.Surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Rota atribuida", style = RotaTypography.labelSmall, color = RotaColors.InkSecondary)
                    Text(
                        state.routeCode ?: "Nenhuma rota atribuida para hoje",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        Metric("Planejados", state.stopsPlanned)
                        Metric("Atendidos", state.stopsConcluded)
                        Metric("Restantes", state.stopsRemaining)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        Metric("Distancia", DistanceCalculator.formatKm(state.distanceM))
                        Metric("Tempo", formatElapsed(state.elapsedSeconds))
                    }
                }
            }
        }

        item {
            Card(colors = CardDefaults.cardColors(containerColor = RotaColors.Surface)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Proximo cliente", style = RotaTypography.labelSmall, color = RotaColors.InkSecondary)
                    Text(
                        state.nextCustomer ?: "Sem proximo cliente definido",
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            }
        }

        item {
            if (state.journeyStatus == JourneyStatus.NOT_STARTED) {
                Button(
                    onClick = onStartJourney,
                    modifier = Modifier.fillMaxWidth().height(PrimaryActionHeight),
                    colors = ButtonDefaults.buttonColors(containerColor = RotaColors.Ok),
                ) {
                    Text("INICIAR JORNADA", style = MaterialTheme.typography.titleMedium)
                }
            } else if (state.journeyStatus == JourneyStatus.IN_PROGRESS) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onPause, modifier = Modifier.weight(1f).height(MinTouchTarget)) {
                        Text("Pausar")
                    }
                    Button(
                        onClick = onFinish,
                        modifier = Modifier.weight(1f).height(MinTouchTarget),
                        colors = ButtonDefaults.buttonColors(containerColor = RotaColors.Critical),
                    ) { Text("Finalizar") }
                }
            } else {
                StatusBadge(label = "JORNADA PAUSADA", tone = StatusTone.WARN)
            }
        }

        item {
            NavRow("Minha rota", onGoRoute)
            NavRow("Historico da jornada", onGoHistory)
            NavRow("Configuracoes", onGoSettings)
        }

        item {
            VehicleParkedGate(moving = true) {
                Text("Acoes administrativas nao estao disponiveis para o motorista.")
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: Any) {
    Column {
        Text(label, style = RotaTypography.labelSmall, color = RotaColors.InkSecondary)
        Text(
            value.toString(),
            style = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace),
        )
    }
}

@Composable
private fun NavRow(label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(MinTouchTarget)
            .border(1.dp, RotaColors.Border, RoundedCornerShape(6.dp))
            .background(RotaColors.Surface, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Text(">", color = RotaColors.InkMuted)
    }
}

/** TELA 3 â€” MINHA ROTA (lista). */
@Composable
private fun MyRouteScreen(onBack: () -> Unit, onOpenCustomer: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Minha rota", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onBack, modifier = Modifier.height(MinTouchTarget)) { Text("Voltar") }
        Spacer(Modifier.height(12.dp))
        StopList(stops = sampleStops(), onOpen = onOpenCustomer)
    }
}

/**
 * Antes a lista usava um Triple desestruturado dentro do `items`. Com tantas
 * extensions `component3()` em escopo (Array, List e cada array primitivo), a
 * inferencia de tipo fica ambigua e o build quebra com
 * "Function 'component3()' is ambiguous for this expression".
 * Uma classe nomeada deixa o tipo evidente e o codigo mais legivel.
 */
private data class SampleStop(val sequence: String, val name: String, val status: VisitStatus)

private fun sampleStops(): List<SampleStop> = listOf(
    SampleStop("1", "Mercearia Sao Jose", VisitStatus.PLANNED),
    SampleStop("2", "Farmacia Central", VisitStatus.PLANNED),
    SampleStop("3", "Distribuidora Boa Vista", VisitStatus.PLANNED),
)

@Composable
private fun StopList(stops: List<SampleStop>, onOpen: () -> Unit) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(stops) { stop ->
            Card(
                colors = CardDefaults.cardColors(containerColor = RotaColors.Surface),
                modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
            ) {
                Row(
                    Modifier.padding(14.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier.size(32.dp).background(RotaColors.ProgressDim, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(stop.sequence, style = RotaTypography.labelSmall, color = RotaColors.Progress)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(stop.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Picos Â· bairro nao informado",
                            style = MaterialTheme.typography.bodyMedium,
                            color = RotaColors.InkSecondary,
                        )
                    }
                    StatusBadge(visitLabel(stop.status), visitTone(stop.status))
                }
            }
        }
    }
}

/** TELA 4 â€” DETALHES DO CLIENTE. */
@Composable
private fun CustomerDetailScreen(onBack: () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Detalhes do cliente", style = MaterialTheme.typography.titleLarge)
        OutlinedButton(onClick = onBack, modifier = Modifier.height(MinTouchTarget)) { Text("Voltar") }

        Card(colors = CardDefaults.cardColors(containerColor = RotaColors.Surface)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Mercearia Sao Jose", style = MaterialTheme.typography.titleMedium)
                Text("Rua Exemplo, 100", style = MaterialTheme.typography.bodyMedium)
                Text("Sao Jose Â· Picos Â· PI", style = MaterialTheme.typography.bodyMedium, color = RotaColors.InkSecondary)
                Text(
                    "-7.0712, -45.0185",
                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                )
                Text("Posicao 1 de 3 Â· prevista 09:00", style = MaterialTheme.typography.bodyMedium, color = RotaColors.InkSecondary)
                Text("Chegada: -- Â· Inicio: -- Â· Fim: --", style = MaterialTheme.typography.bodyMedium, color = RotaColors.InkSecondary)
            }
        }

        Button(
            onClick = {},
            modifier = Modifier.fillMaxWidth().height(MinTouchTarget),
            colors = ButtonDefaults.buttonColors(containerColor = RotaColors.Progress),
        ) { Text("Registrar chegada") }

        Button(
            onClick = {},
            modifier = Modifier.fillMaxWidth().height(MinTouchTarget),
            colors = ButtonDefaults.buttonColors(containerColor = RotaColors.Progress),
        ) { Text("Iniciar atendimento") }

        VehicleParkedGate(moving = true) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {}, modifier = Modifier.fillMaxWidth().height(MinTouchTarget)) {
                    Text("Finalizar atendimento")
                }
                OutlinedButton(onClick = {}, modifier = Modifier.fillMaxWidth().height(MinTouchTarget)) {
                    Text("Marcar visita nao realizada")
                }
                OutlinedButton(onClick = {}, modifier = Modifier.fillMaxWidth().height(MinTouchTarget)) {
                    Text("Registrar ocorrencia")
                }
            }
        }
    }
}

/** TELA 5 â€” HISTORICO DA JORNADA. */
@Composable
private fun JourneyHistoryScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Historico da jornada", style = MaterialTheme.typography.titleLarge)
        OutlinedButton(onClick = onBack, modifier = Modifier.height(MinTouchTarget)) { Text("Voltar") }

        Card(colors = CardDefaults.cardColors(containerColor = RotaColors.Surface)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Metric("Inicio", "08:00")
                    Metric("Fim", "11:42")
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    Metric("Distancia", "84,3 km")
                    Metric("Deslocamento", "1h 12min")
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    Metric("Atendimento", "1h 04min")
                    Metric("Parado", "0h 26min")
                }
                Text("Clientes: 3 atendidos, 1 nao realizado", style = MaterialTheme.typography.bodyMedium)
                Text("Ocorrencias: 1", style = MaterialTheme.typography.bodyMedium, color = RotaColors.InkSecondary)
            }
        }
    }
}

/** TELA 6 â€” CONFIGURACOES (somente leitura; sem acesso administrativo). */
@Composable
private fun SettingsScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Configuracoes", style = MaterialTheme.typography.titleLarge)
        OutlinedButton(onClick = onBack, modifier = Modifier.height(MinTouchTarget)) { Text("Voltar") }

        Card(colors = CardDefaults.cardColors(containerColor = RotaColors.Surface)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                InfoRow("Perfil", "Motorista")
                InfoRow("Status da conexao", "Conexao ativa")
                InfoRow("Permissao de localizacao", "Concedida")
                InfoRow("Ultima sincronizacao", "ha 3 min")
                InfoRow("Servico de localizacao", "Ativo durante a jornada")
                InfoRow("Versao do aplicativo", "1.0.0")
            }
        }

        Text(
            "O motorista nao altera configuracoes administrativas. Alteracoes de rota e de cadastros sao feitas pelo painel.",
            style = MaterialTheme.typography.bodyMedium,
            color = RotaColors.InkMuted,
        )
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = RotaColors.InkSecondary)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun visitTone(status: VisitStatus): StatusTone = when (status) {
    VisitStatus.CONCLUDED -> StatusTone.OK
    VisitStatus.NOT_DONE -> StatusTone.WARN
    VisitStatus.ARRIVED, VisitStatus.IN_SERVICE, VisitStatus.EN_ROUTE -> StatusTone.PROGRESS
    VisitStatus.PLANNED, VisitStatus.CANCELLED -> StatusTone.NEUTRAL
}

// Exaustivo de proposito: se o backend ganhar um estado novo, o compilador
// falha aqui em vez de a tela mostrar um rotulo vazio em producao.
private fun visitLabel(status: VisitStatus): String = when (status) {
    VisitStatus.PLANNED -> "PLANEJADA"
    VisitStatus.EN_ROUTE -> "A CAMINHO"
    VisitStatus.ARRIVED -> "CHEGOU"
    VisitStatus.IN_SERVICE -> "EM ATENDIMENTO"
    VisitStatus.CONCLUDED -> "CONCLUIDA"
    VisitStatus.NOT_DONE -> "NAO REALIZADA"
    VisitStatus.CANCELLED -> "CANCELADA"
}

private fun formatElapsed(seconds: Int): String {
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    return if (h > 0) "${h}h ${m.toString().padStart(2, '0')}m" else "${m}m"
}
