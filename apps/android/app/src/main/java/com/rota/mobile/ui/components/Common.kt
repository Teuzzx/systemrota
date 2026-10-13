package com.rota.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.rota.mobile.ui.theme.RotaColors
import com.rota.mobile.ui.theme.RotaTypography

enum class StatusTone { OK, PROGRESS, WARN, CRITICAL, NEUTRAL }

private fun toneColor(tone: StatusTone): Pair<Color, Color> = when (tone) {
    StatusTone.OK -> RotaColors.Ok to RotaColors.OkDim
    StatusTone.PROGRESS -> RotaColors.Progress to RotaColors.ProgressDim
    StatusTone.WARN -> RotaColors.Warn to RotaColors.WarnDim
    StatusTone.CRITICAL -> RotaColors.Critical to RotaColors.CriticalDim
    StatusTone.NEUTRAL -> RotaColors.Neutral to RotaColors.NeutralDim
}

/**
 * Badge de status: ponto + ROTULO.
 * Regra do DESIGN_DNA: status nunca e comunicado so por cor.
 */
@Composable
fun StatusBadge(label: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val (fg, bg) = toneColor(tone)
    Row(
        modifier = modifier
            .background(bg, RoundedCornerShape(4.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        androidx.compose.foundation.layout.Box(
            Modifier.size(6.dp).background(fg, CircleShape)
        )
        Text(label, style = RotaTypography.labelSmall, color = fg)
    }
}

/** Faixa fixa de status: conexao, sincronizacao e permissao de localizacao. */
@Composable
fun ConnectionBar(
    online: Boolean,
    pendingItems: Int,
    locationGranted: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(RotaColors.NeutralDim)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        StatusBadge(
            label = if (online) "CONECTADO" else "SEM CONEXAO",
            tone = if (online) StatusTone.OK else StatusTone.WARN,
        )
        StatusBadge(
            label = if (pendingItems > 0) "SINCRONIZAR: $pendingItems" else "SINCRONIZADO",
            tone = if (pendingItems > 0) StatusTone.WARN else StatusTone.OK,
        )
        StatusBadge(
            label = if (locationGranted) "LOCALIZACAO OK" else "SEM PERMISSAO",
            tone = if (locationGranted) StatusTone.OK else StatusTone.CRITICAL,
        )
    }
}

/**
 * Bloqueio de acoes que distraem durante a direcao.
 * O DESIGN_DNA exige confirmacao com o veiculo parado.
 */
@Composable
fun VehicleParkedGate(moving: Boolean, action: @Composable () -> Unit) {
    if (moving) {
        Column(
            Modifier
                .fillMaxWidth()
                .border(1.dp, RotaColors.Warn, RoundedCornerShape(6.dp))
                .background(RotaColors.WarnDim)
                .padding(16.dp),
        ) {
            Text("Estacione o veiculo para continuar", style = MaterialTheme.typography.titleMedium, color = RotaColors.Warn)
            Text(
                "Esta acao exige o veiculo parado para nao desviar a atencao durante o deslocamento.",
                style = MaterialTheme.typography.bodyMedium,
                color = RotaColors.InkSecondary,
            )
        }
    } else {
        action()
    }
}
