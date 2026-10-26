package com.aarogyam.staff.tasks

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.CompleteBody
import com.aarogyam.staff.api.model.MyTasks
import com.aarogyam.staff.api.model.TaskOccurrence
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

/** `GET /api/v1/tasks/mine` (`listMyTasks`): the caller's tasks for [date] (`YYYY-MM-DD`, today by default). */
internal suspend fun ClinicApi.myTasks(date: String? = null): Outcome<MyTasks, ApiError> =
    client.call {
        url("api/v1/tasks/mine")
        date?.let { parameter("date", it) }
    }

/** `POST /api/v1/tasks/occurrences/{id}/complete` (`completeTask`); the same `client_id` makes a retry harmless. */
internal suspend fun ClinicApi.completeTask(
    id: String,
    body: CompleteBody,
): Outcome<TaskOccurrence, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/tasks/occurrences/${id.encodeURLPathPart()}/complete")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
