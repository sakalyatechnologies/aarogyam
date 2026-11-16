package com.aarogyam.staff.android.ui.more

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.art.ArtImage
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.art.AvatarArt
import com.aarogyam.staff.device.PreferenceKey
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** The avatar choice: an illustration's art ID, or [PHOTO] for a picture kept on this phone only (server storage is BK-10). */
object AvatarChoice {
    const val PHOTO = "photo"
    private const val DEFAULT = "d1"
    private const val SIDE = 256
    private const val QUALITY = 85

    /** Bumped when the photo file changes, so a drawn avatar reloads it. */
    var revision by mutableIntStateOf(0)
        private set

    fun current(graph: AppGraph): String = graph.preferences.get(PreferenceKey.AvatarChoice) ?: DEFAULT

    private fun file(context: Context) = File(context.filesDir, "avatar.jpg")

    fun photo(context: Context): Bitmap? =
        file(context).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }

    /** Keeps a square, small copy of the picture at [uri] as the avatar photo. */
    suspend fun savePhoto(
        context: Context,
        graph: AppGraph,
        uri: Uri,
    ): Boolean =
        withContext(Dispatchers.Default) {
            runCatching {
                val source =
                    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                        ?: return@runCatching false
                val side = minOf(source.width, source.height)
                val scale = android.graphics.Matrix().apply { postScale(SIDE.toFloat() / side, SIDE.toFloat() / side) }
                val small =
                    Bitmap.createBitmap(
                        source,
                        (source.width - side) / 2,
                        (source.height - side) / 2,
                        side,
                        side,
                        scale,
                        true,
                    )
                file(context).outputStream().use { small.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
                graph.preferences.set(PreferenceKey.AvatarChoice, PHOTO)
                revision++
                true
            }.getOrDefault(false)
        }
}

/** The person's avatar drawn into its frame: their photo, or the chosen illustration. */
@Composable
fun MyAvatar(
    avatar: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    if (avatar == AvatarChoice.PHOTO) {
        val photo = remember(AvatarChoice.revision) { AvatarChoice.photo(context) }
        if (photo != null) {
            Image(
                photo.asImageBitmap(),
                null,
                modifier.fillMaxHeight().fillMaxWidth(),
                contentScale = ContentScale.Crop,
            )
            return
        }
    }
    AvatarArt.all[avatar]?.let { ArtImage(it, modifier.fillMaxWidth().fillMaxHeight()) }
}

/** "Your avatar": the eight illustrated dentists, or a photo from the camera or library (iOS `AvatarPicker`). */
@Composable
fun AvatarPicker(
    graph: AppGraph,
    onChange: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var chosen by remember { mutableStateOf(AvatarChoice.current(graph)) }
    val target = remember { newCameraTarget(context) }
    val saved: (Uri) -> Unit = { uri ->
        scope.launch {
            if (AvatarChoice.savePhoto(context, graph, uri)) {
                chosen = AvatarChoice.PHOTO
                onChange()
            }
        }
    }
    val take =
        rememberLauncherForActivityResult(
            ActivityResultContracts.TakePicture(),
        ) { done -> if (done) saved(target.second) }
    val pick =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri !=
                null
            ) {
                saved(uri)
            }
        }
    val p = SkTheme.palette
    SkModalSheet(stringResource(R.string.sh_v7_avatar_title), onDismiss) {
        Text(
            stringResource(R.string.sh_v7_avatar_message),
            style = SkTypography.bodyText,
            color = p.onSurfaceVariant.color,
        )
        val ids = AvatarArt.all.keys.sorted()
        LazyVerticalGrid(
            GridCells.Fixed(COLUMNS),
            Modifier.heightIn(max = GRID_MAX.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(ids) { id ->
                val on = chosen == id
                val label = stringResource(R.string.sh_v7_avatar_option, id)
                val shape = RoundedCornerShape(TILE_RADIUS.dp)
                androidx.compose.foundation.layout.Box(
                    Modifier
                        .aspectRatio(1f)
                        .clip(shape)
                        .background(p.surface2.color)
                        .border(
                            2.dp,
                            if (on) p.primary.color else androidx.compose.ui.graphics.Color.Transparent,
                            shape,
                        ).clickable(role = Role.RadioButton) {
                            chosen = id
                            graph.preferences.set(PreferenceKey.AvatarChoice, id)
                            onChange()
                        }.semantics {
                            contentDescription = label
                            selected = on
                        },
                ) {
                    AvatarArt.all[id]?.let { ArtImage(it, Modifier.fillMaxWidth().fillMaxHeight()) }
                }
            }
        }
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SkPillButton(
                stringResource(R.string.sh_v7_avatar_camera),
                { take.launch(target.second) },
                Modifier.weight(1f),
                variant = SkPillVariant.Tonal,
            )
            SkPillButton(
                stringResource(R.string.sh_v7_avatar_library),
                { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                Modifier.weight(1f),
                variant = SkPillVariant.Tonal,
            )
        }
    }
}

private const val COLUMNS = 4
private const val GRID_MAX = 260
private const val TILE_RADIUS = 22
