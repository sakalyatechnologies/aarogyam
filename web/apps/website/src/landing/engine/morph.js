import { getShapes } from './shapes.js'
import { themeState, GOLD, REDUCED } from './theme.js'

// Glowing particle system that morphs between sampled shapes.
// Reads the live accent color from themeState every frame.
export class MorphEngine {
  constructor(canvas, { count = 500, shape = 'tooth', pulse = true, pscale = 1 } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.count = count
    this.pulse = pulse
    this.pscale = pscale
    this.tPts = getShapes()[shape]
    this.mx = -9999
    this.my = -9999
    this.t = Math.random() * 10
    this.parts = []
    this.W = 0
    this.H = 0
    this._raf = 0

    this._onMove = (e) => {
      const r = canvas.getBoundingClientRect()
      this.mx = e.clientX - r.left
      this.my = e.clientY - r.top
    }
    this._onLeave = () => { this.mx = -9999; this.my = -9999 }
    this._onResize = () => this.resize()

    const host = canvas.parentElement
    if (host) {
      host.addEventListener('mousemove', this._onMove)
      host.addEventListener('mouseleave', this._onLeave)
    }
    window.addEventListener('resize', this._onResize)

    this.resize()
    this.frame()
    if (!REDUCED) {
      const loop = () => { this.frame(); this._raf = requestAnimationFrame(loop) }
      this._raf = requestAnimationFrame(loop)
    }
  }

  // Horizontal anchor for the particle cloud: on desktop the hero text sits
  // left, so the anatomy floats in the right column (68%); centered on mobile.
  pcx() { return this.W > 900 ? 0.68 : 0.5 }
  psc() { return this.W > 900 ? 0.6 : 1 }

  seed() {
    const { W, H, tPts } = this
    const cx = this.pcx(), sc = this.psc()
    this.parts = []
    for (let k = 0; k < this.count; k++) {
      const p = tPts[(Math.random() * tPts.length) | 0]
      const px = (cx + p[0] * sc) * W, py = (0.5 + p[1] * sc) * H
      this.parts.push({
        x: px + (Math.random() - 0.5) * 34,
        y: py + (Math.random() - 0.5) * 34,
        tx: px, ty: py, vx: 0, vy: 0,
        jx: (Math.random() - 0.5) * 16, jy: (Math.random() - 0.5) * 16,
        s: (Math.random() * 1.9 + 0.7) * this.pscale,
        a: Math.random() * 0.5 + 0.35,
        gold: Math.random() < 0.10,
        ph: Math.random() * 6.283,
        l: 52 + Math.random() * 22,
      })
    }
  }

  resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    const r = this.canvas.getBoundingClientRect()
    this.W = Math.max(50, r.width)
    this.H = Math.max(50, r.height)
    this.canvas.width = this.W * dpr
    this.canvas.height = this.H * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.seed()
  }

  morphTo(name) {
    const tPts = getShapes()[name]
    if (!tPts) return
    this.tPts = tPts
    const { W, H } = this
    const cx = this.pcx(), sc = this.psc()
    for (const p of this.parts) {
      const q = tPts[(Math.random() * tPts.length) | 0]
      p.tx = (cx + q[0] * sc) * W
      p.ty = (0.5 + q[1] * sc) * H
    }
  }

  drawPulse() {
    const { ctx, W, H, t } = this
    const yb = H * 0.88, amp = H * 0.042, per = 150, off = (t * 70) % per
    ctx.save()
    const g = ctx.createLinearGradient(0, 0, W, 0)
    g.addColorStop(0, 'rgba(242,193,78,0)')
    g.addColorStop(0.12, GOLD)
    g.addColorStop(0.88, GOLD)
    g.addColorStop(1, 'rgba(242,193,78,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = 2
    ctx.shadowColor = GOLD
    ctx.shadowBlur = 8
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    for (let x = 0; x <= W; x += 5) {
      const ph = ((x + off) % per) / per
      let y = yb
      y -= amp * 0.18 * Math.exp(-(((ph - 0.18) * 7) ** 2))
      y -= amp * 0.62 * Math.exp(-(((ph - 0.42) * 13) ** 2))
      y += amp * 0.30 * Math.exp(-(((ph - 0.5) * 13) ** 2))
      y -= amp * 0.22 * Math.exp(-(((ph - 0.66) * 7) ** 2))
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  frame() {
    const { ctx, W, H } = this
    this.t += 0.016
    const t = this.t
    const br = REDUCED ? 0 : 1
    ctx.clearRect(0, 0, W, H)
    for (const p of this.parts) {
      p.vx = (p.vx + (p.tx + p.jx - p.x) * 0.045) * 0.86
      p.vy = (p.vy + (p.ty + p.jy - p.y) * 0.045) * 0.86
      const dx = p.x - this.mx, dy = p.y - this.my
      const d2 = dx * dx + dy * dy
      if (d2 < 12000) {
        const d = Math.sqrt(d2) || 1
        const f = (110 - Math.sqrt(d2)) / 110 * 3.2
        p.vx += (dx / d) * f
        p.vy += (dy / d) * f
      }
      p.x += p.vx + Math.sin(t * 1.3 + p.ph) * 0.3 * br
      p.y += p.vy + Math.cos(t * 1.1 + p.ph) * 0.3 * br
      ctx.globalAlpha = p.a * (0.72 + 0.28 * Math.sin(t * 2 + p.ph) * br + 0.14)
      ctx.fillStyle = p.gold ? GOLD : `hsla(${themeState.h},${themeState.s}%,${p.l}%,1)`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.s, 0, 6.283)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    if (this.pulse) this.drawPulse()
  }

  destroy() {
    cancelAnimationFrame(this._raf)
    window.removeEventListener('resize', this._onResize)
    const host = this.canvas.parentElement
    if (host) {
      host.removeEventListener('mousemove', this._onMove)
      host.removeEventListener('mouseleave', this._onLeave)
    }
  }
}
