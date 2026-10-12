package com.aarogyam.staff.outbox

import com.aarogyam.staff.clinic.ClinicContext

/** What a stub sender answers: the kind is known but its sender is not built yet. The entry waits, nothing is lost. */
const val NOT_BUILT_YET = "not_built_yet"

/** Sends [OutboxKind.PatientFile] entries. Stub until v10 T3 builds it; the entry waits (`not_built_yet`). */
internal class PatientFileSender(
    @Suppress("unused") private val opened: (String) -> ClinicContext?,
    @Suppress("unused") private val files: OutboxFiles,
) : OutboxSender {
    override suspend fun send(entry: OutboxEntry): SendResult = SendResult.Retry(NOT_BUILT_YET)
}
