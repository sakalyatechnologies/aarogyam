package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.richtext.Block
import com.aarogyam.staff.richtext.Inline
import com.aarogyam.staff.richtext.RichText
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Draws stored clinical text (the Markdown subset) with the app's own styles; nothing is interpreted as HTML. */
@Composable
fun RichTextView(
    text: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp)) {
        RichText.parse(text).forEach { block ->
            when (block) {
                is Block.Heading -> {
                    Text(
                        block.children.styled(),
                        style = if (block.level == 1) SkTypography.title else SkTypography.headline,
                        color = SkTheme.colors.text.color,
                    )
                }

                is Block.Paragraph -> {
                    Body(block.children.styled())
                }

                is Block.Bullets -> {
                    block.items.forEach { Item("•", it) }
                }

                is Block.Numbers -> {
                    block.items.forEachIndexed { index, item -> Item("${index + 1}.", item) }
                }
            }
        }
    }
}

@Composable
private fun Item(
    marker: String,
    inlines: List<Inline>,
) {
    Row {
        Text(
            marker,
            style = SkTypography.bodyText,
            color = SkTheme.colors.text.color,
            modifier = Modifier.padding(end = Spacing.SM.dp),
        )
        Body(inlines.styled())
    }
}

@Composable
private fun Body(text: AnnotatedString) = Text(text, style = SkTypography.bodyText, color = SkTheme.colors.text.color)

private fun List<Inline>.styled(): AnnotatedString = buildAnnotatedString { forEach { append(it) } }

private fun AnnotatedString.Builder.append(inline: Inline) {
    when (inline) {
        is Inline.Text -> {
            append(inline.text)
        }

        Inline.Break -> {
            append('\n')
        }

        is Inline.Bold -> {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { inline.children.forEach { append(it) } }
        }

        is Inline.Italic -> {
            withStyle(
                SpanStyle(fontStyle = FontStyle.Italic),
            ) { inline.children.forEach { append(it) } }
        }
    }
}
