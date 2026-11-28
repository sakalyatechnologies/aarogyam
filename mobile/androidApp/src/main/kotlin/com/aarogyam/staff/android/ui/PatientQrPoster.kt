package com.aarogyam.staff.android.ui

import android.content.Context
import android.graphics.Bitmap
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.ui.graphics.asAndroidBitmap
import com.aarogyam.staff.android.ui.today.qrImage
import java.io.ByteArrayOutputStream

/**
 * Prints a poster for [url]: the clinic name, a big [caption] and the QR. Same route as the desk receipt: a small HTML
 * page handed to the system print dialog, which also saves a PDF. Nothing is logged.
 */
internal fun printPoster(
    context: Context,
    url: String,
    clinicName: String,
    caption: String,
) {
    val bitmap = qrImage(url)?.asAndroidBitmap() ?: return
    val png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, PNG_QUALITY, it) }
    val data = Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP)

    fun esc(text: String): String = android.text.Html.escapeHtml(text)
    val html =
        "<html><head><meta charset=utf-8><style>" +
            "body{font-family:sans-serif;text-align:center;margin:48px;color:#111}" +
            "h1{font-size:34px;margin:0 0 24px}h2{font-size:56px;margin:0 0 32px}" +
            "img{width:420px;height:420px;image-rendering:pixelated}</style></head><body>" +
            "<h1>${esc(clinicName)}</h1><h2>${esc(caption)}</h2>" +
            "<img src=\"data:image/png;base64,$data\"></body></html>"
    val web = WebView(context)
    web.webViewClient =
        object : WebViewClient() {
            override fun onPageFinished(
                view: WebView,
                url: String?,
            ) {
                val manager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
                manager.print(caption, view.createPrintDocumentAdapter(caption), PrintAttributes.Builder().build())
            }
        }
    web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
}

private const val PNG_QUALITY = 100
