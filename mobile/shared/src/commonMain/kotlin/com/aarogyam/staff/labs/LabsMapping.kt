package com.aarogyam.staff.labs

import com.aarogyam.staff.api.model.LabOrder
import com.aarogyam.staff.api.model.LabReminderChannel
import com.aarogyam.staff.api.model.LabReminders
import com.aarogyam.staff.api.model.LabTrackerStage

/** The five steps of the lab tracker, in order. */
enum class LabStage(
    internal val wire: LabTrackerStage,
) {
    Impression(LabTrackerStage.IMPRESSION),
    Production(LabTrackerStage.PRODUCTION),
    Trial(LabTrackerStage.TRIAL),
    Final(LabTrackerStage.FINAL),
    Delivered(LabTrackerStage.DELIVERED),
    ;

    internal companion object {
        fun of(wire: LabTrackerStage): LabStage = entries.first { it.wire == wire }
    }
}

/** How a batch reminder reaches the labs. */
enum class ReminderChannel(
    internal val wire: LabReminderChannel,
) {
    Email(LabReminderChannel.EMAIL),
    WhatsApp(LabReminderChannel.WHATSAPP),
}

/** One lab a batch reminder reached; [waLink] is set on the WhatsApp channel, for staff to open and send. */
data class LabReminded(
    val vendorId: String,
    val vendorName: String,
    val orderNumbers: List<String>,
    val waLink: String?,
)

/** Why a batch reminder left an order out. */
enum class SkipReason { NotAtLab, NoEmail, NoPhone, Other }

data class LabSkipped(
    val number: String,
    val reason: SkipReason,
)

/** What a batch reminder did: the labs reached and the orders left out. */
data class LabRemindResult(
    val channel: ReminderChannel,
    val labs: List<LabReminded>,
    val skipped: List<LabSkipped>,
)

internal fun LabReminders.toResult(channel: ReminderChannel) =
    LabRemindResult(
        channel = channel,
        labs = vendors.map { LabReminded(it.vendorId, it.vendorName, it.orderNumbers, it.waLink?.ifBlank { null }) },
        skipped =
            skipped.map {
                LabSkipped(
                    it.number,
                    when (it.reason) {
                        "not_at_lab" -> SkipReason.NotAtLab
                        "no_email" -> SkipReason.NoEmail
                        "no_phone" -> SkipReason.NoPhone
                        else -> SkipReason.Other
                    },
                )
            },
    )

internal fun LabOrder.toCase() =
    LabCase(
        id = id,
        number = number,
        status = LabStatus.of(status),
        labName = vendorName,
        contactName = contactName,
        phone = contactPhone ?: vendorPhone,
        whatsapp = contactWhatsapp,
        patientName = patientName,
        patientNumber = patientNumber,
        work = items.sortedBy { it.lineNo }.map { it.workType },
        teeth = items.flatMap { it.teeth }.distinct().sorted(),
        dueOn = dueOn,
        stage = stage,
        lastContactedAt = lastContactedAt,
        tracker = trackerStage?.let(LabStage::of),
    )
