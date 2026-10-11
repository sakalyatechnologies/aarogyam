package com.aarogyam.staff.outbox

import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome

/** What sending one entry did. Codes only. */
sealed interface SendResult {
    data object Delivered : SendResult

    /** Network error or 5xx: try again later with the same entry. */
    data class Retry(
        val code: String,
    ) : SendResult

    /** A 4xx: the server will not accept it. The entry stays, marked failed. */
    data class Rejected(
        val code: String,
    ) : SendResult
}

/**
 * Sends one entry. Look at [OutboxEntry.kind], decode [OutboxEntry.payload], call the API with
 * [OutboxEntry.id] as the client id or `Idempotency-Key`, and return `outcome.toSendResult()`.
 */
fun interface OutboxSender {
    suspend fun send(entry: OutboxEntry): SendResult
}

/**
 * Success is delivered. Transport errors, 5xx, 408 and 429 retry; 401 and 426 also retry (the
 * person can sign in or update, and the write should still go out). Other 4xx are rejected.
 */
fun Outcome<*, ApiError>.toSendResult(): SendResult =
    when (this) {
        is Outcome.Success -> {
            SendResult.Delivered
        }

        is Outcome.Failure -> {
            val status = error.status
            val retry = error.isRetryable || status == 401 || status == 426 || status == 408 || status == 429
            if (retry) SendResult.Retry(error.code.value) else SendResult.Rejected(error.code.value)
        }
    }
