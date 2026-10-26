package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.LabContactLogEntry
import com.aarogyam.staff.api.model.LabOrder
import com.aarogyam.staff.api.model.LabOrderList
import com.aarogyam.staff.api.model.LabOrderStatusChange
import com.aarogyam.staff.api.model.LabReminderQueued
import com.aarogyam.staff.api.model.LabVendorList
import com.aarogyam.staff.api.model.NewLabOrder
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/lab-vendors` (`listLabVendors`): the clinic's labs with their contacts. */
suspend fun ClinicApi.labVendors(): Outcome<LabVendorList, ApiError> = client.call { url("api/v1/lab-vendors") }

/** `GET /api/v1/lab-orders` (`listLabOrders`): newest first, optionally only [overdue] ones. */
suspend fun ClinicApi.labOrders(overdue: Boolean = false): Outcome<LabOrderList, ApiError> =
    client.call {
        url("api/v1/lab-orders")
        if (overdue) parameter("overdue", "true")
    }

/** `GET /api/v1/lab-orders/{id}` (`getLabOrder`): one case with its history. */
suspend fun ClinicApi.labOrder(id: String): Outcome<LabOrder, ApiError> =
    client.call { url("api/v1/lab-orders/${id.encodeURLPathPart()}") }

/** `POST /api/v1/lab-orders` (`createLabOrder`): a new case, sent now or kept as a draft. */
suspend fun ClinicApi.createLabOrder(order: NewLabOrder): Outcome<LabOrder, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/lab-orders")
        contentType(ContentType.Application.Json)
        setBody(order)
    }

/** `POST /api/v1/lab-orders/{id}/status` (`setLabOrderStatus`): sent, in progress, received, fitted and so on. */
suspend fun ClinicApi.moveLabOrder(
    id: String,
    change: LabOrderStatusChange,
): Outcome<LabOrder, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/lab-orders/${id.encodeURLPathPart()}/status")
        contentType(ContentType.Application.Json)
        setBody(change)
    }

/** `POST /api/v1/lab-orders/{id}/contacts-log` (`logLabContact`): a call, WhatsApp, email or visit, and what came of it. */
suspend fun ClinicApi.logLabContact(
    id: String,
    entry: LabContactLogEntry,
): Outcome<LabOrder, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/lab-orders/${id.encodeURLPathPart()}/contacts-log")
        contentType(ContentType.Application.Json)
        setBody(entry)
    }

/** `POST /api/v1/lab-orders/{id}/remind` (`remindLab`): emails the lab a reminder (202). */
suspend fun ClinicApi.remindLab(id: String): Outcome<LabReminderQueued, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/lab-orders/${id.encodeURLPathPart()}/remind")
    }
