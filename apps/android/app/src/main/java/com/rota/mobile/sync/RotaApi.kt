package com.rota.mobile.sync

import android.content.Context
import com.rota.mobile.BuildConfig
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Resposta do backend para lote de eventos. */
@Serializable
data class SyncEventsResponse(
    val accepted: List<String> = emptyList(),
    val duplicates: List<String> = emptyList(),
    val rejected: List<RejectedItem> = emptyList(),
    val routeVersionConflict: RouteVersionConflict = RouteVersionConflict(false, null, null),
)

@Serializable
data class RejectedItem(val clientEventId: String, val reason: String)

@Serializable
data class RouteVersionConflict(
    val detected: Boolean = false,
    val deviceVersion: Int? = null,
    val serverVersion: Int? = null,
)

@Serializable
data class SyncLocationsResponse(
    val accepted: Int = 0,
    val duplicates: Int = 0,
    val rejected: List<RejectedLocation> = emptyList(),
    val distanceM: Double = 0.0,
)

@Serializable
data class RejectedLocation(val clientPointId: String, val reason: String)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class LoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

/**
 * Cliente HTTP minimo.
 *
 * O refresh token fica em armazenamento SEGURO do Android (EncryptedSharedPreferences
 * ou keystore). Nenhuma chave de servico externo e embarcada no app.
 */
object RotaApi {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    @Volatile
    var accessToken: String? = null

    private fun post(path: String, body: String): Request {
        val builder = Request.Builder()
            .url("${BuildConfig.API_BASE_URL}$path")
            .post(body.toRequestBody(jsonMedia))
        accessToken?.let { builder.header("Authorization", "Bearer $it") }
        return builder.build()
    }

    fun login(context: Context, email: String, password: String): LoginResponse {
        val body = json.encodeToString(LoginRequest(email, password))
        client.newCall(post("/api/auth/login", body)).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("Credenciais invalidas (${response.code}).")
            val text = response.body?.string() ?: throw IllegalStateException("Resposta vazia.")
            return json.decodeFromString<LoginResponse>(text)
        }
    }

    fun sendEvents(context: Context, body: String): SyncEventsResponse {
        client.newCall(post("/api/sync/events", body)).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("Falha ao sincronizar eventos (${response.code}).")
            return json.decodeFromString(response.body?.string() ?: "{}")
        }
    }

    fun sendLocations(context: Context, body: String): SyncLocationsResponse {
        client.newCall(post("/api/locations/batch", body)).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("Falha ao enviar localizacao (${response.code}).")
            return json.decodeFromString(response.body?.string() ?: "{}")
        }
    }
}
