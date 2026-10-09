package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Analytics
import com.aarogyam.staff.api.model.Expense
import com.aarogyam.staff.api.model.ExpenseList
import com.aarogyam.staff.api.model.NewExpense
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.datetime.LocalDate

/** `GET /api/v1/expenses` (`listExpenses`): expenses spent on clinic days [from] to [to], voided ones included. */
suspend fun ClinicApi.expenses(
    from: LocalDate,
    to: LocalDate,
): Outcome<ExpenseList, ApiError> =
    client.call {
        url("api/v1/expenses")
        parameter("from", from.toString())
        parameter("to", to.toString())
    }

/** `POST /api/v1/expenses` (`recordExpense`): records one expense. Not retried automatically (no idempotency key yet, BK-6). */
suspend fun ClinicApi.recordExpense(expense: NewExpense): Outcome<Expense, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/expenses")
        contentType(ContentType.Application.Json)
        setBody(expense)
    }

/** `GET /api/v1/reports/analytics` (`getAnalytics`): buckets of [bucket] (`week` or `month`) from [from] to [to]. */
suspend fun ClinicApi.analytics(
    bucket: String,
    from: LocalDate,
    to: LocalDate,
): Outcome<Analytics, ApiError> =
    client.call {
        url("api/v1/reports/analytics")
        parameter("bucket", bucket)
        parameter("from", from.toString())
        parameter("to", to.toString())
    }
