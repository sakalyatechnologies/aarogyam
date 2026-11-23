package com.aarogyam.staff.android.ui.story

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import com.aarogyam.staff.story.StoryBridge

/**
 * A WebView that loads only the story bundle shipped in the app, from the secure origin
 * `appassets.androidplatform.net/story/` (module scripts and WebCodecs need one). Every other
 * navigation is refused, so the bridge object is never exposed to another page.
 */
@SuppressLint("SetJavaScriptEnabled") // the bundle is the app's own code, and nothing else can load
internal fun storyWebView(
    context: Context,
    onMessage: (String) -> Unit,
): WebView {
    val assets = WebViewAssetLoader.AssetsPathHandler(context)
    val loader =
        WebViewAssetLoader
            .Builder()
            .addPathHandler("/story/") { path -> assets.handle("story/$path") }
            .build()
    val main = Handler(Looper.getMainLooper())
    return WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mediaPlaybackRequiresUserGesture = true
        webViewClient =
            object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url) ?: refused()

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean = !request.url.isStory()
            }
        addJavascriptInterface(
            object {
                @JavascriptInterface
                fun post(text: String) {
                    main.post { onMessage(text) }
                }
            },
            StoryBridge.ANDROID_INTERFACE,
        )
        loadUrl(StoryBridge.ANDROID_ENTRY)
    }
}

/** Nothing outside the bundle loads: no network, no other origin. */
private fun refused(): WebResourceResponse =
    WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), null)

private fun Uri.isStory(): Boolean =
    scheme == "https" && host == "appassets.androidplatform.net" && path.orEmpty().startsWith("/story/")
