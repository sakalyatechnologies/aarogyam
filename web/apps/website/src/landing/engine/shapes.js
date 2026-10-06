// Shape path math + pixel sampling for the particle morph engine.
// Each shape is drawn white on an offscreen canvas; opaque pixels become
// particle targets in normalized [-0.5, 0.5] coordinates.

function rr(x, px, py, w, h, r) {
  x.beginPath()
  x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r)
  x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r)
  x.arcTo(px, py, px + w, py, r)
  x.closePath()
}

export function toothPath(x, s) {
  x.beginPath()
  x.moveTo(-0.42 * s, -0.55 * s)
  x.bezierCurveTo(-0.55 * s, -0.55 * s, -0.52 * s, -0.30 * s, -0.44 * s, -0.18 * s)
  x.bezierCurveTo(-0.40 * s, -0.05 * s, -0.38 * s, 0.10 * s, -0.36 * s, 0.30 * s)
  x.bezierCurveTo(-0.35 * s, 0.52 * s, -0.28 * s, 0.62 * s, -0.22 * s, 0.60 * s)
  x.bezierCurveTo(-0.16 * s, 0.58 * s, -0.14 * s, 0.30 * s, -0.10 * s, 0.12 * s)
  x.bezierCurveTo(-0.06 * s, -0.02 * s, 0.06 * s, -0.02 * s, 0.10 * s, 0.12 * s)
  x.bezierCurveTo(0.14 * s, 0.30 * s, 0.16 * s, 0.58 * s, 0.22 * s, 0.60 * s)
  x.bezierCurveTo(0.28 * s, 0.62 * s, 0.35 * s, 0.52 * s, 0.36 * s, 0.30 * s)
  x.bezierCurveTo(0.38 * s, 0.10 * s, 0.40 * s, -0.05 * s, 0.44 * s, -0.18 * s)
  x.bezierCurveTo(0.52 * s, -0.30 * s, 0.55 * s, -0.55 * s, 0.42 * s, -0.55 * s)
  x.bezierCurveTo(0.25 * s, -0.62 * s, -0.25 * s, -0.62 * s, -0.42 * s, -0.55 * s)
  x.closePath()
}

function sampleShape(draw) {
  const W = 150
  const c = document.createElement('canvas')
  c.width = c.height = W
  const x = c.getContext('2d')
  x.fillStyle = '#fff'
  draw(x, W)
  const d = x.getImageData(0, 0, W, W).data
  const pts = []
  for (let j = 0; j < W; j += 2)
    for (let i = 0; i < W; i += 2)
      if (d[(j * W + i) * 4 + 3] > 128) pts.push([i / W - 0.5, j / W - 0.5])
  return pts
}

let _shapes = null
export function getShapes() {
  if (_shapes) return _shapes
  _shapes = {
  tooth: sampleShape((x, W) => {
    x.save(); x.translate(W / 2, W / 2)
    toothPath(x, W * 0.44)
    x.lineWidth = W * 0.06; x.lineJoin = 'round'; x.lineCap = 'round'
    x.stroke(); x.restore()
  }),
  leaf: sampleShape((x, W) => {
    x.save(); x.translate(W / 2, W / 2)
    const s = W * 0.42
    x.beginPath()
    x.moveTo(0, -0.5 * s)
    x.quadraticCurveTo(0.44 * s, -0.04 * s, 0, 0.5 * s)
    x.quadraticCurveTo(-0.44 * s, -0.04 * s, 0, -0.5 * s)
    x.fill(); x.restore()
  }),
  cross: sampleShape((x, W) => {
    x.save(); x.translate(W / 2, W / 2)
    const s = W * 0.40
    rr(x, -0.13 * s, -0.5 * s, 0.26 * s, s, 0.08 * s); x.fill()
    rr(x, -0.5 * s, -0.13 * s, s, 0.26 * s, 0.08 * s); x.fill()
    x.restore()
  }),
  heart: sampleShape((x, W) => {
    x.save(); x.translate(W / 2, W / 2)
    const s = W * 0.42
    x.beginPath()
    x.moveTo(0, 0.34 * s)
    x.bezierCurveTo(-0.58 * s, -0.02 * s, -0.38 * s, -0.44 * s, 0, -0.16 * s)
    x.bezierCurveTo(0.38 * s, -0.44 * s, 0.58 * s, -0.02 * s, 0, 0.34 * s)
    x.fill(); x.restore()
  }),
  }
  return _shapes
}

export const SHAPE_NAMES = {
  tooth: 'MOLAR · 32 teeth, one chart',
  leaf: 'THE LEAF · the Aarogyam mark',
  cross: 'THE CROSS · every specialty, one system',
  heart: 'THE PULSE · patients who feel remembered',
}
