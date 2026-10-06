import { useEffect, useRef, useState } from 'react'
import { THEMES } from '../engine/theme.js'
import logoUrl from '../../assets/aarogyam-logo-sm.png'

const DOTS = Object.entries(THEMES).map(([id, t]) => ({ id, hex: t.hex }))

// Caduceus logo on an ivory medallion so it reads on dark and light modes.
export function LeafMark({ size = 30 }) {
  return (
    <span className="logo-medal" style={{ width: size + 6, height: size + 6 }}>
      <img src={logoUrl} alt="" width={size} height={size} />
    </span>
  )
}

export default function Nav({ accentName, onPick, onPickCustom, mode, onToggleMode, onLogo, onLink, onSignIn, onRegister }) {
  const links = [
    ['Product', 'sec-feat'],
    ['Live demo', 'sec-demo'],
    ['Specialities', 'sec-spec'],
    ['Pricing', 'sec-price'],
  ]
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('#10d9a0')
  const ref = useRef(null)
  const swatch = THEMES[accentName]?.hex || custom

  useEffect(() => {
    if (!open) return
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  return (
    <nav className="nav">
      <a className="brand" href="#top" aria-label="Aarogyam home" onClick={(e) => { e.preventDefault(); onLogo() }}>
        <LeafMark />
        Aarogyam
      </a>
      <div className="nav-links">
        {links.map(([label, id]) => (
          <a key={id} href={'#' + id} onClick={(e) => { e.preventDefault(); onLink(id) }}>
            {label}
          </a>
        ))}
      </div>
      <div className="themepick" ref={ref}>
        <button className="palettebtn" title="Theme color" aria-expanded={open} onClick={() => setOpen(!open)} style={{ '--sw': swatch }}>
          <span className="psw" />🎨
        </button>
        {open && (
          <div className="palettepop">
            <div className="pptitle">Theme color</div>
            <div className="pprow">
              {DOTS.map((d) => (
                <span
                  key={d.id}
                  title={d.id}
                  className={'tdot' + (accentName === d.id ? ' on' : '')}
                  style={{ background: d.hex, color: d.hex }}
                  onClick={() => { onPick(d.id); setOpen(false) }}
                />
              ))}
            </div>
            <label className="ppcustom">
              <span className="pick" title="Custom color">
                <input type="color" defaultValue={custom} onInput={(e) => { setCustom(e.target.value); onPickCustom(e.target.value) }} />
              </span>
              <span>Custom…</span>
            </label>
          </div>
        )}
      </div>
      <button className="modebtn" onClick={onToggleMode} title="Dark / light mode">
        {mode === 'dark' ? '🌙' : '☀️'}
      </button>
      <button className="btn neutral" style={{ padding: '10px 20px' }} onClick={onSignIn}>
        Sign in
      </button>
      <button className="btn" style={{ padding: '10px 20px' }} onClick={onRegister}>
        Get started
      </button>
    </nav>
  )
}
