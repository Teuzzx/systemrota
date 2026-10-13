package com.rota.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Tema do app de campo (DESIGN_DNA secao 9).
 *
 * Tema CLARO e o padrao: uso externo sob sol forte exige alto contraste.
 * Alvo de toque minimo 56dp; numerais em fonte tabular.
 */
object RotaColors {
    val Base = Color(0xFFF4F6F8)
    val Surface = Color(0xFFFFFFFF)
    val Ink = Color(0xFF12171E)
    val InkSecondary = Color(0xFF4A5563)
    val InkMuted = Color(0xFF6B7683)
    val Border = Color(0xFFD8DEE6)

    val Ok = Color(0xFF1F7A4C)
    val OkDim = Color(0xFFE3F3EA)
    val Progress = Color(0xFF1D5FBF)
    val ProgressDim = Color(0xFFE4EEFB)
    val Warn = Color(0xFF9A6606)
    val WarnDim = Color(0xFFFBF0DA)
    val Critical = Color(0xFFB3261E)
    val CriticalDim = Color(0xFFFCE7E5)
    val Neutral = Color(0xFF6B7683)
    val NeutralDim = Color(0xFFEDEFF2)
    val Accent = Color(0xFF0F6C78)
}

/** Tipografia: numeros sempre em fonte tabular (mono). */
val RotaTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.SemiBold,
        fontSize = 34.sp,
        letterSpacing = (-0.5).sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 16.sp,
        lineHeight = 22.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        letterSpacing = 0.8.sp,
    ),
)

private val LightScheme = lightColorScheme(
    primary = RotaColors.Accent,
    onPrimary = Color.White,
    secondary = RotaColors.Progress,
    onSecondary = Color.White,
    background = RotaColors.Base,
    onBackground = RotaColors.Ink,
    surface = RotaColors.Surface,
    onSurface = RotaColors.Ink,
    error = RotaColors.Critical,
    onError = Color.White,
    outline = RotaColors.Border,
)

@Composable
fun RotaTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    // Tema claro fixo: o app de campo e usado em condicoes de sol forte.
    MaterialTheme(
        colorScheme = LightScheme,
        typography = RotaTypography,
        content = content,
    )
}

/** Alvo de toque minimo do DESIGN_DNA. */
val MinTouchTarget = 56.dp

/** Altura do botao de jornada (acao mais importante da tela inicial). */
val PrimaryActionHeight = 72.dp
