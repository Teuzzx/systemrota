package com.rota.mobile.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import kotlinx.serialization.Serializable

/**
 * Persistencia local (offline-first).
 *
 * Regras:
 *  - todo evento tem `clientEventId` (UUID gerado no dispositivo): e a chave de
 *    idempotencia usada na sincronizacao;
 *  - `synced` marca o que ja subiu; o WorkManager reenvia o que falta;
 *  - locacao e armazenada com `retainedUntil` conforme a politica de retencao.
 */

@Entity(tableName = "routes")
data class RouteEntity(
    @PrimaryKey val id: String,
    val code: String,
    val name: String,
    val version: Int,
    val plannedDate: String,
    val downloadedAt: Long,
)

@Entity(tableName = "customers")
data class CustomerEntity(
    @PrimaryKey val id: String,
    val routeId: String,
    val externalId: String?,
    val tradeName: String,
    val contactName: String?,
    val phone: String?,
    val addressLine: String?,
    val neighborhood: String?,
    val city: String,
    val latitude: Double?,
    val longitude: Double?,
    val geocodeStatus: String,
    val sequence: Int,
    val plannedArrivalAt: Long?,
    val estTravelFromPrevS: Int?,
    val estDistanceFromPrevM: Double?,
    val visitStatus: String,
    val arrivedAt: Long?,
    val serviceStartedAt: Long?,
    val serviceEndedAt: Long?,
    val notDoneReason: String?,
    val notDoneNote: String?,
)

@Entity(tableName = "pending_events")
data class PendingEventEntity(
    @PrimaryKey val clientEventId: String,
    val journeyId: String,
    val sequenceNo: Int,
    val type: String,
    val capturedAt: Long,
    val payloadJson: String?,
    val latitude: Double?,
    val longitude: Double?,
    val accuracyM: Float?,
    val createdAt: Long,
)

@Entity(tableName = "pending_locations")
data class PendingLocationEntity(
    @PrimaryKey val clientPointId: String,
    val journeyId: String,
    val sequenceNo: Int,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Float,
    val speedMps: Float?,
    val bearingDeg: Float?,
    val connectivity: String,
    val batteryPct: Int?,
    val capturedAt: Long,
    val retainedUntil: Long,
)

@Entity(tableName = "journeys")
data class JourneyEntity(
    @PrimaryKey val id: String,
    val driverId: String,
    val routeId: String?,
    val routeVersionAtStart: Int?,
    val status: String,
    val startedAt: Long,
    val endedAt: Long?,
    val pauseTotalS: Int,
)

@Dao
interface RouteDao {
    @Query("SELECT * FROM routes WHERE id = :id")
    suspend fun route(id: String): RouteEntity?

    @Query("SELECT * FROM routes ORDER BY plannedDate DESC")
    suspend fun all(): List<RouteEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(route: RouteEntity)

    @Query("DELETE FROM routes WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers WHERE routeId = :routeId ORDER BY sequence ASC")
    suspend fun byRoute(routeId: String): List<CustomerEntity>

    @Query("SELECT * FROM customers WHERE routeId = :routeId AND id = :id")
    suspend fun byId(routeId: String, id: String): CustomerEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(customers: List<CustomerEntity>)

    @Query("UPDATE customers SET visitStatus = :status, arrivedAt = :arrivedAt WHERE routeId = :routeId AND id = :id")
    suspend fun markArrived(routeId: String, id: String, status: String, arrivedAt: Long)

    @Query(
        "UPDATE customers SET visitStatus = :status, serviceStartedAt = :startedAt " +
            "WHERE routeId = :routeId AND id = :id"
    )
    suspend fun markServiceStarted(routeId: String, id: String, status: String, startedAt: Long)

    @Query(
        "UPDATE customers SET visitStatus = :status, serviceEndedAt = :endedAt, " +
            "notDoneReason = :reason, notDoneNote = :note WHERE routeId = :routeId AND id = :id"
    )
    suspend fun markFinished(
        routeId: String, id: String, status: String, endedAt: Long, reason: String?, note: String?,
    )
}

@Dao
interface PendingEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(events: List<PendingEventEntity>)

    /** Idempotencia local: Ignore impede evento repetido na fila. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: PendingEventEntity)

    @Query("SELECT * FROM pending_events WHERE journeyId = :journeyId ORDER BY sequenceNo ASC LIMIT :limit")
    suspend fun pendingForJourney(journeyId: String, limit: Int): List<PendingEventEntity>

    @Query("DELETE FROM pending_events WHERE clientEventId IN (:ids)")
    suspend fun deleteAll(ids: List<String>)

    @Query("SELECT COUNT(*) FROM pending_events")
    suspend fun count(): Int

    @Query("SELECT MIN(capturedAt) FROM pending_events")
    suspend fun oldestCapturedAt(): Long?
}

@Dao
interface PendingLocationDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(points: List<PendingLocationEntity>)

    @Query("SELECT * FROM pending_locations WHERE journeyId = :journeyId ORDER BY capturedAt ASC LIMIT :limit")
    suspend fun pendingForJourney(journeyId: String, limit: Int): List<PendingLocationEntity>

    @Query("DELETE FROM pending_locations WHERE clientPointId IN (:ids)")
    suspend fun deleteAll(ids: List<String>)

    @Query("SELECT * FROM pending_locations WHERE journeyId = :journeyId ORDER BY capturedAt ASC")
    suspend fun allForJourney(journeyId: String): List<PendingLocationEntity>

    @Query("SELECT COUNT(*) FROM pending_locations")
    suspend fun count(): Int
}

@Dao
interface JourneyDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(journey: JourneyEntity)

    @Query("SELECT * FROM journeys WHERE status IN ('IN_PROGRESS','PAUSED') ORDER BY startedAt DESC LIMIT 1")
    suspend fun active(): JourneyEntity?

    @Query("SELECT * FROM journeys WHERE id = :id")
    suspend fun byId(id: String): JourneyEntity?

    @Query("SELECT * FROM journeys WHERE driverId = :driverId ORDER BY startedAt DESC")
    suspend fun history(driverId: String): List<JourneyEntity>
}

@Database(
    entities = [
        RouteEntity::class,
        CustomerEntity::class,
        PendingEventEntity::class,
        PendingLocationEntity::class,
        JourneyEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class RotaDatabase : RoomDatabase() {
    abstract fun routeDao(): RouteDao
    abstract fun customerDao(): CustomerDao
    abstract fun pendingEventDao(): PendingEventDao
    abstract fun pendingLocationDao(): PendingLocationDao
    abstract fun journeyDao(): JourneyDao

    companion object {
        const val NAME = "rota.db"
    }
}

/** Modelo serializado para envio (espelha os DTOs da API). */
@Serializable
data class SyncEventDto(
    val clientEventId: String,
    val journeyId: String,
    val sequenceNo: Int,
    val type: String,
    val capturedAt: String,
    val payload: Map<String, String>? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracyM: Float? = null,
)

@Serializable
data class SyncLocationDto(
    val clientPointId: String,
    val sequenceNo: Int,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Float,
    val capturedAt: String,
    val speedMps: Float? = null,
    val bearingDeg: Float? = null,
    val connectivity: String = "ONLINE",
    val batteryPct: Int? = null,
)
