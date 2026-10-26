package com.aarogyam.staff.outbox

import com.sakalya.mobile.http.NetworkMonitor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Whether the phone has a network. The outbox sends only while [online]. */
interface Connectivity {
    val online: StateFlow<Boolean>
}

/** Reads the app's [NetworkMonitor], so the outbox and the HTTP clients agree. */
fun NetworkMonitor.asConnectivity(): Connectivity =
    object : Connectivity {
        override val online: StateFlow<Boolean> = isOnline
    }

/** Connectivity the caller sets, for tests and previews. */
class ManualConnectivity(
    online: Boolean = true,
) : Connectivity {
    override val online = MutableStateFlow(online)
}
