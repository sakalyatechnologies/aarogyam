package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.AppGraph
import com.sakalya.mobile.auth.RefreshToken
import com.sakalya.mobile.auth.SecureSessionStore
import com.sakalya.mobile.auth.Session
import com.sakalya.mobile.auth.UserId
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.http.AccessToken
import com.sakalya.mobile.securestorage.PlatformSecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.time.Clock
import kotlin.time.Duration.Companion.seconds

/** A person from `db/seed/local.sql`. */
private data class SeededPerson(
    val name: String,
    val authUid: String,
)

private val people =
    listOf(
        SeededPerson("Asha Kulkarni (owner, Sunrise)", "a1a1a1a1-0000-4000-8000-000000000001"),
        SeededPerson("Dr Dev Rao (doctor, Sunrise and Lotus)", "a1a1a1a1-0000-4000-8000-000000000002"),
        SeededPerson("Farah Shaikh (front desk, Sunrise)", "a1a1a1a1-0000-4000-8000-000000000003"),
        SeededPerson("Bina Joshi (owner, Lotus)", "b1b1b1b1-0000-4000-8000-000000000001"),
    )

private const val DEV_TOKEN_URL = "http://app.localtest.me:5173/api/v1/dev/token"
private const val TIMEOUT_MS = 5_000

/**
 * Local flavour, debug build only: one button per seeded person. It asks the local API for a
 * development token (which the API mints only in its `local` environment), saves it as the
 * session and asks the graph to restore it. Nothing here exists in any other variant.
 */
@Composable
fun DevSignInPanel(graph: AppGraph) {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var failed by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().padding(Spacing.XL.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
    ) {
        Text(
            "Development sign-in (local debug build)",
            style = SkTypography.overline,
            color = SkTheme.colors.textMuted.color,
        )
        if (failed) Text("The local API did not answer.", color = SkTheme.colors.text.color)
        for (person in people) {
            SkButton(person.name, {
                scope.launch {
                    val session = withContext(Dispatchers.IO) { mint(person.authUid) }
                    failed = session == null
                    if (session != null) {
                        SecureSessionStore(PlatformSecureStore(context, "aarogyam")).save(session)
                        graph.restore()
                    }
                }
            }, Modifier.fillMaxWidth(), variant = SkButtonVariant.Secondary)
        }
    }
}

private fun mint(authUid: String): Session? =
    runCatching {
        val connection = URL(DEV_TOKEN_URL).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write("""{"auth_uid":"$authUid"}""".toByteArray()) }
            val body = JSONObject(connection.inputStream.use { it.readBytes().decodeToString() })
            val userId = requireNotNull(UserId.parse(authUid))
            Session(
                AccessToken(body.getString("access_token")),
                RefreshToken("dev-token-has-no-refresh"),
                Clock.System.now() + body.getLong("expires_in").seconds,
                userId,
            )
        } finally {
            connection.disconnect()
        }
    }.getOrNull()
