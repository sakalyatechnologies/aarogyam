package com.aarogyam.staff.art

import com.sakalya.mobile.design.PathCommand
import com.sakalya.mobile.design.PathData
import com.sakalya.mobile.design.PathParse

/** This layer's path with its matrix applied, or null if the path does not parse. */
fun ArtLayer.pathData(): PathData? {
    val parsed = (PathData.parse(path) as? PathParse.Parsed)?.path ?: return null
    if (matrix == ArtLayer.IDENTITY) return parsed
    val (a, b, c, d, e, f) = Matrix(matrix)

    fun x(
        px: Double,
        py: Double,
    ) = a * px + c * py + e

    fun y(
        px: Double,
        py: Double,
    ) = b * px + d * py + f
    return PathData(
        parsed.commands.map { cmd ->
            when (cmd) {
                is PathCommand.MoveTo -> {
                    PathCommand.MoveTo(x(cmd.x, cmd.y), y(cmd.x, cmd.y))
                }

                is PathCommand.LineTo -> {
                    PathCommand.LineTo(x(cmd.x, cmd.y), y(cmd.x, cmd.y))
                }

                is PathCommand.CubicTo -> {
                    PathCommand.CubicTo(
                        x(cmd.x1, cmd.y1),
                        y(cmd.x1, cmd.y1),
                        x(cmd.x2, cmd.y2),
                        y(cmd.x2, cmd.y2),
                        x(cmd.x, cmd.y),
                        y(cmd.x, cmd.y),
                    )
                }

                PathCommand.Close -> {
                    PathCommand.Close
                }
            }
        },
    )
}

/** Every layer as one path, for a single-colour line icon. */
fun ArtPiece.outline(): PathData = PathData(layers.flatMap { it.pathData()?.commands.orEmpty() })

/** The v7 icons by name, as outlines for the kit's `SkIcon`; an unknown name draws nothing. */
object Icons {
    private val cache = mutableMapOf<String, PathData>()

    fun of(name: String): PathData = cache.getOrPut(name) { IconArt.all[name]?.outline() ?: PathData(emptyList()) }
}

private data class Matrix(
    val a: Double,
    val b: Double,
    val c: Double,
    val d: Double,
    val e: Double,
    val f: Double,
) {
    constructor(m: List<Double>) : this(m[0], m[1], m[2], m[3], m[4], m[5])
}
