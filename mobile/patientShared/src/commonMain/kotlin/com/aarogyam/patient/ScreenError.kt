package com.aarogyam.patient

import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.ErrorCode

/**
 * Why a screen could not load; each platform maps these to its own copy. A copy of the staff
 * app's (both move to sakalya-mobile).
 */
enum class ScreenError {
    Offline,
    Network,
    SignedOut,
    NotAllowed,
    NotFound,
    UpgradeRequired,
    Server,
    NotConfigured,
    Unknown,
    ;

    companion object {
        /** The error code used when this build has no host for the environment. */
        val NOT_CONFIGURED: ErrorCode = ErrorCode.parse("not_configured") ?: ErrorCode.UnexpectedResponse

        /** Maps an [ApiError] to what the screen shows. */
        fun of(error: ApiError): ScreenError =
            if (error.code == NOT_CONFIGURED) {
                NotConfigured
            } else {
                when (error.kind) {
                    ApiErrorKind.Transport -> if (error.code == ErrorCode.Offline) Offline else Network
                    ApiErrorKind.SessionRefresh -> Network
                    ApiErrorKind.Unauthenticated -> SignedOut
                    ApiErrorKind.Forbidden -> NotAllowed
                    ApiErrorKind.NotFound -> NotFound
                    ApiErrorKind.UpgradeRequired -> UpgradeRequired
                    ApiErrorKind.Internal, ApiErrorKind.Unavailable, ApiErrorKind.TooManyRequests -> Server
                    else -> Unknown
                }
            }

        internal fun notConfigured(): ApiError =
            ApiError(NOT_CONFIGURED, "no host configured for this environment", null, null)
    }
}
