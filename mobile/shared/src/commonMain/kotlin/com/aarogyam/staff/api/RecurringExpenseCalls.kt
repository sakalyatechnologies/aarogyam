package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewRecurringExpense
import com.aarogyam.staff.api.model.RecurringExpense
import com.aarogyam.staff.api.model.RecurringExpenseList
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/recurring-expenses` (`listRecurringExpenses`, needs `finance.view`): by next due day, stopped ones last. */
suspend fun ClinicApi.recurringExpenses(): Outcome<RecurringExpenseList, ApiError> =
    client.call { url("api/v1/recurring-expenses") }

/** `POST /api/v1/recurring-expenses` (`createRecurringExpense`, needs `expenses.write`): sets one up. */
suspend fun ClinicApi.createRecurringExpense(body: NewRecurringExpense): Outcome<RecurringExpense, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/recurring-expenses")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `POST /api/v1/recurring-expenses/{id}/pause` (`pauseRecurringExpense`): 409 unless it is active. */
suspend fun ClinicApi.pauseRecurringExpense(id: String): Outcome<RecurringExpense, ApiError> =
    recurringStep(id, "pause")

/** `POST /api/v1/recurring-expenses/{id}/resume` (`resumeRecurringExpense`): 409 unless it is paused. */
suspend fun ClinicApi.resumeRecurringExpense(id: String): Outcome<RecurringExpense, ApiError> =
    recurringStep(id, "resume")

/** `POST /api/v1/recurring-expenses/{id}/stop` (`stopRecurringExpense`): final; expenses already recorded stay. */
suspend fun ClinicApi.stopRecurringExpense(id: String): Outcome<RecurringExpense, ApiError> = recurringStep(id, "stop")

private suspend fun ClinicApi.recurringStep(
    id: String,
    step: String,
): Outcome<RecurringExpense, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/recurring-expenses/${id.encodeURLPathPart()}/$step")
    }
