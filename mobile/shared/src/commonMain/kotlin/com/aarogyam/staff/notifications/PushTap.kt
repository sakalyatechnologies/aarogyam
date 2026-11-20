package com.aarogyam.staff.notifications

/** Where a tapped push goes: the screens the app can open from one. */
enum class PushScreen { Today, Queue, Tasks, Labs }

/**
 * What a tapped push carries (ids and a path, never a name): the kind, the clinic (`org_id`), the
 * staff notification id and the in-app `href`. Any field may be missing; none may crash the app.
 */
data class PushTap(
    val kind: String?,
    val orgId: String?,
    val notificationId: String?,
    val href: String?,
) {
    /** The screen for [href]; `/today` and anything unknown go to Today. */
    val screen: PushScreen get() = screenFor(href)

    companion object {
        /** Reads the `userInfo` of a notification (the values arrive as `Any?`, so non-text values are ignored). */
        fun of(userInfo: Map<*, *>): PushTap =
            PushTap(
                kind = text(userInfo["kind"]),
                orgId = text(userInfo["org_id"]),
                notificationId = text(userInfo["id"]),
                href = text(userInfo["href"]),
            )

        /** `/queue` is the desk board or the doctor's waiting list, `/tasks` My tasks, `/labs` Labs. */
        fun screenFor(href: String?): PushScreen {
            val path =
                href
                    ?.trim()
                    ?.substringBefore('?')
                    ?.substringBefore('#')
                    ?.trimEnd('/')
                    .orEmpty()
            return when {
                path == "/queue" || path.startsWith("/queue/") -> PushScreen.Queue
                path == "/tasks" || path.startsWith("/tasks/") -> PushScreen.Tasks
                path == "/labs" || path.startsWith("/labs/") -> PushScreen.Labs
                else -> PushScreen.Today
            }
        }

        /**
         * The patient a `/patients/{id}` path names (a plan reply), or null for any other path. Ids
         * only: the path never carries a name.
         */
        fun patientIdFor(href: String?): String? {
            val parts =
                href
                    ?.trim()
                    ?.substringBefore('?')
                    ?.substringBefore('#')
                    ?.trim('/')
                    ?.split('/')
                    .orEmpty()
            return parts.takeIf { it.size == 2 && it[0] == "patients" }?.get(1)?.takeIf(String::isNotBlank)
        }

        private fun text(value: Any?): String? = (value as? String)?.trim()?.takeIf { it.isNotEmpty() }
    }
}
