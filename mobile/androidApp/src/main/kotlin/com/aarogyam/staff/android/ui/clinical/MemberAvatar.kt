package com.aarogyam.staff.android.ui.clinical

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import com.aarogyam.staff.android.ui.art.ArtImage
import com.aarogyam.staff.api.model.Avatar
import com.aarogyam.staff.art.AvatarArt
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkAvatarFrame
import com.sakalya.mobile.designcompose.SkAvatarShape
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.color

/**
 * A team member's avatar (BK-10): the illustration they chose, or their photo fetched through
 * [photo]; initials while it loads or when they have none.
 */
@Composable
fun MemberAvatar(
    name: String,
    avatar: Avatar?,
    tone: SkTone,
    size: Dp,
    photo: suspend (Avatar?) -> ByteArray?,
) {
    val art = avatar?.preset?.let { AvatarArt.all[it] }
    val bitmap: Bitmap? by produceState<Bitmap?>(null, avatar?.photoUrl?.substringBefore('?')) {
        value =
            if (art != null || avatar?.photoUrl == null) {
                null
            } else {
                photo(avatar)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            }
    }
    val p = SkTheme.palette
    val loaded = bitmap
    when {
        art != null -> {
            SkAvatarFrame(
                SkAvatarShape.Circle,
                size,
                p.primaryContainer.color,
            ) { ArtImage(art, Modifier.fillMaxSize()) }
        }

        loaded != null -> {
            SkAvatarFrame(SkAvatarShape.Circle, size, p.primaryContainer.color) {
                Image(loaded.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            }
        }

        else -> {
            SkAvatar(name, tone = tone, size = size)
        }
    }
}
