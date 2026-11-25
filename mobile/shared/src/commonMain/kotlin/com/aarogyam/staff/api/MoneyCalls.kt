package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Analytics
import com.aarogyam.staff.api.model.CollectSummary
import com.aarogyam.staff.api.model.DownloadLink
import com.aarogyam.staff.api.model.Expense
import com.aarogyam.staff.api.model.ExpenseList
import com.aarogyam.staff.api.model.Invoice
import com.aarogyam.staff.api.model.NewExpense
import com.aarogyam.staff.api.model.UpiLink
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import com.sakalya.mobile.http.idempotencyKey
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
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

/** `POST /api/v1/expenses` (`recordExpense`): records one expense; the same [key] again returns it instead of a second one. */
suspend fun ClinicApi.recordExpense(
    expense: NewExpense,
    key: IdempotencyKey,
): Outcome<Expense, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/expenses")
        idempotencyKey(key)
        contentType(ContentType.Application.Json)
        setBody(expense)
    }

/**
 * `POST /api/v1/expenses/{id}/bill` (`uploadExpenseBill`): the bill photo, a JPEG already resized on
 * the device, replacing any earlier one. 409 when the expense is void, 413 over 10 MB.
 */
suspend fun ClinicApi.uploadExpenseBill(
    id: String,
    jpeg: ByteArray,
): Outcome<Expense, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/expenses/${id.encodeURLPathPart()}/bill")
        setBody(
            MultiPartFormDataContent(
                formData {
                    append(
                        "file",
                        jpeg,
                        Headers.build {
                            append(HttpHeaders.ContentType, "image/jpeg")
                            append(HttpHeaders.ContentDisposition, "filename=\"bill.jpg\"")
                        },
                    )
                },
            ),
        )
    }

/** `DELETE /api/v1/expenses/{id}/bill` (`removeExpenseBill`): the expense without its bill photo. */
suspend fun ClinicApi.removeExpenseBill(id: String): Outcome<Expense, ApiError> =
    client.call {
        method = HttpMethod.Delete
        url("api/v1/expenses/${id.encodeURLPathPart()}/bill")
    }

/** `GET /api/v1/expenses/{id}/bill/download` (`getExpenseBillDownloadLink`): a five-minute link; needs `finance.view`. */
suspend fun ClinicApi.expenseBillLink(id: String): Outcome<DownloadLink, ApiError> =
    client.call { url("api/v1/expenses/${id.encodeURLPathPart()}/bill/download") }

/** `GET /api/v1/reports/analytics` (`getAnalytics`): buckets of [bucket] (`day` up to 92 days, `week` or `month`) from [from] to [to]. */
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

/**
 * `POST /api/v1/invoices/{id}/issue` (`issueInvoice`, needs `billing.write`): issues a draft (GST, round-off,
 * number). Final. 409 when it is already issued or void; 422 when it has no lines.
 */
suspend fun ClinicApi.issueInvoice(id: String): Outcome<Invoice, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/invoices/${id.encodeURLPathPart()}/issue")
    }

/**
 * `GET /api/v1/invoices/{id}/collect-summary` (`getCollectSummary`): what the desk collects on a bill
 * (draft or issued), with its UPI link. Needs `payments.collect`, not `billing.read`.
 */
suspend fun ClinicApi.collectSummary(id: String): Outcome<CollectSummary, ApiError> =
    client.call { url("api/v1/invoices/${id.encodeURLPathPart()}/collect-summary") }

/** `GET /api/v1/invoices/{id}` (`getInvoice`): one bill with its lines; a draft's amounts are a preview of the lines. */
suspend fun ClinicApi.invoice(id: String): Outcome<Invoice, ApiError> =
    client.call { url("api/v1/invoices/${id.encodeURLPathPart()}") }

/** `GET /api/v1/invoices/{id}/upi-link` (`getInvoiceUpiLink`): the UPI link and QR text for what is left on an issued bill. Records nothing. */
suspend fun ClinicApi.invoiceUpiLink(invoiceId: String): Outcome<UpiLink, ApiError> =
    client.call { url("api/v1/invoices/${invoiceId.encodeURLPathPart()}/upi-link") }
