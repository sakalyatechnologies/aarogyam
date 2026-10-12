package com.aarogyam.staff.outbox

import com.aarogyam.staff.clinic.ClinicContext

/** Sends [OutboxKind.Audio] entries. Stub until v10 T5 builds it; the entry waits (`not_built_yet`). */
internal class AudioSender(
    @Suppress("unused") private val opened: (String) -> ClinicContext?,
    @Suppress("unused") private val files: OutboxFiles,
) : OutboxSender {
    override suspend fun send(entry: OutboxEntry): SendResult = SendResult.Retry(NOT_BUILT_YET)
}
