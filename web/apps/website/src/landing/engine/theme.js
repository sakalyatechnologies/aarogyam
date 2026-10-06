// Shared mutable theme state — the canvas engine reads this every frame,
// so theme changes apply live without recreating anything.
export const themeState = { h: 160, s: 85 }

export const GOLD = '#f2c14e'

export const REDUCED =
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

export const THEMES = {
  tulsi:  { hex: '#10d9a0', h: 160, s: 85 },
  haldi:  { hex: '#f2c14e', h: 44,  s: 92 },
  indigo: { hex: '#5b6cff', h: 232, s: 90 },
  rose:   { hex: '#ff6b8b', h: 345, s: 95 },
  ocean:  { hex: '#38bdf8', h: 200, s: 90 },
  plum:   { hex: '#a855f7', h: 275, s: 80 },
}

export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (mx + mn) / 2
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    switch (mx) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h *= 60
  }
  return [Math.round(h), Math.round(s * 100)]
}

export function applyTheme(nameOrHex) {
  const t = THEMES[nameOrHex] || null
  let h, s, hex
  if (t) { h = t.h; s = t.s; hex = t.hex }
  else { const hsl = hexToHsl(nameOrHex); h = hsl[0]; s = hsl[1]; hex = nameOrHex }
  themeState.h = h; themeState.s = s
  const r = document.documentElement.style
  r.setProperty('--ac', hex)
  r.setProperty('--acg', hex + '2e')
  r.setProperty('--h', h)
  r.setProperty('--s', s + '%')
}

export function applyMode(m) {
  if (m === 'light') document.documentElement.dataset.theme = 'light'
  else document.documentElement.removeAttribute('data-theme')
}
