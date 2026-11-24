package com.aarogyam.staff.android.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.aarogyam.staff.android.MainActivity
import com.aarogyam.staff.android.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Receives FCM: hands a new token to the app and shows alerts that arrive while it is open. */
class AarogyamMessagingService : FirebaseMessagingService() {
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onNewToken(token: String) {
        PushInbox.setToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Title and body are the server's, as sent; nothing of our own is added.
        val title = message.notification?.title ?: message.data["title"]
        val body = message.notification?.body ?: message.data["body"]
        if (title == null && body == null) return
        ensureChannel(this)
        val open =
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        PushInbox.KEYS.forEach { key -> message.data[key]?.let { open.putExtra(key, it) } }
        val id = (message.data["id"] ?: message.messageId ?: "").hashCode()
        val pending =
            PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification =
            NotificationCompat
                .Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(id, notification) }
    }

    companion object {
        const val CHANNEL_ID = "clinic_alerts"

        fun ensureChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.push_channel_name),
                    NotificationManager.IMPORTANCE_HIGH,
                ),
            )
        }
    }
}
