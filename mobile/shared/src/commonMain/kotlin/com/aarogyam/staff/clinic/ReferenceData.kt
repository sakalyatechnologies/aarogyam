package com.aarogyam.staff.clinic

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.Practitioner
import com.aarogyam.staff.api.model.QuickPicks
import com.aarogyam.staff.api.model.Room
import com.aarogyam.staff.api.quickPicks
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * A clinic's doctors, rooms and quick picks. They change rarely, so each list is requested once and kept
 * until sign-out; a failed request is not cached and is retried by the next caller.
 */
class ReferenceData(
    private val api: ClinicApi,
) {
    private val lock = Mutex()
    private var practitioners: List<Practitioner>? = null
    private var rooms: List<Room>? = null
    private var picks: QuickPicks? = null

    /** Doctors, by name. */
    suspend fun practitioners(): Outcome<List<Practitioner>, ApiError> =
        lock.withLock {
            practitioners?.let { return Outcome.Success(it) }
            when (val result = api.practitioners()) {
                is Outcome.Success -> Outcome.Success(result.value.items.also { practitioners = it })
                is Outcome.Failure -> result
            }
        }

    /** Chairs, rooms and labs, in list order. */
    suspend fun rooms(): Outcome<List<Room>, ApiError> =
        lock.withLock {
            rooms?.let { return Outcome.Success(it) }
            when (val result = api.rooms()) {
                is Outcome.Success -> Outcome.Success(result.value.items.also { rooms = it })
                is Outcome.Failure -> result
            }
        }

    /** The specialty's quick picks (allergies, complaints, medicine sets). */
    suspend fun quickPicks(): Outcome<QuickPicks, ApiError> =
        lock.withLock {
            picks?.let { return Outcome.Success(it) }
            when (val result = api.quickPicks()) {
                is Outcome.Success -> Outcome.Success(result.value.also { picks = it })
                is Outcome.Failure -> result
            }
        }
}
