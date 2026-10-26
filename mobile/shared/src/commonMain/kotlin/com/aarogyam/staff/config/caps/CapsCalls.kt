package com.aarogyam.staff.config.caps

import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ErrorCode

/** What a call answers with while its capability flag is off: a local, typed "this server cannot do that yet". */
val NOT_SUPPORTED: ErrorCode = requireNotNull(ErrorCode.parse("not_supported"))

fun notSupported(feature: String): ApiError = ApiError.local(NOT_SUPPORTED, "the server does not support $feature yet")
