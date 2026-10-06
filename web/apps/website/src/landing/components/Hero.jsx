import { useEffect, useRef, useState, useCallback } from 'react'
import { MorphEngine } from '../engine/morph.js'
import { SHAPE_NAMES } from '../engine/shapes.js'
import { REDUCED } from '../engine/theme.js'

const ORDER = [
  { id: 'tooth', icon: '🦷', tag: 'Molar' },
  { id: 'leaf', icon: '🍃', tag: 'Leaf' },
  { id: 'cross', icon: '✚', tag: 'Cross' },
  { id: 'heart', icon: '💓', tag: 'Pulse' },
]
const TRUST = ['Smile Care', 'Apollo Dental', 'CityCare', 'LifeLine', 'CarePoint']
export default function Hero({ onRegister }) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const idxRef = useRef(0)
  const timerRef = useRef(0)
  const [shapeIdx, setShapeIdx] = useState(0)

  const goTo = useCallback((i) => {
    idxRef.current = i
    engineRef.current?.morphTo(ORDER[i].id)
    setShapeIdx(i)
  }, [])

  const cycle = useCallback(() => {
    goTo((idxRef.current + 1) % ORDER.length)
  }, [goTo])

  const poke = useCallback(
    (i) => {
      goTo(i)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        if (!REDUCED) timerRef.current = setInterval(cycle, 5000)
      }
    },
    [goTo, cycle]
  )

  useEffect(() => {
    const eng = new MorphEngine(canvasRef.current, {
      count: window.innerWidth < 700 ? 380 : 850,
      shape: 'tooth',
      pulse: true,
      pscale: 1.3,
    })
    engineRef.current = eng
    if (!REDUCED) timerRef.current = setInterval(cycle, 5000)
    const onLoad = () => eng.resize()
    const onClick = (e) => {
      if (e.target.closest('a,button,.shape-chips')) return
      cycle()
    }
    const cv = canvasRef.current
    cv.addEventListener('click', onClick)
    window.addEventListener('load', onLoad)
    return () => {
      clearInterval(timerRef.current)
      window.removeEventListener('load', onLoad)
      cv.removeEventListener('click', onClick)
      eng.destroy()
    }
  }, [cycle])

  return (
    <header className="hero" id="top">
      <canvas id="heroCanvas" ref={canvasRef} title="Tap to morph" />
      <div className="hero-inner wrap">
        <div className="eyebrow">✨ Clinic OS · In active pilot</div>
        <h1>
          Run your entire clinic from <span className="grad">one calm place.</span>
        </h1>
        <p className="sub">
          Appointments, patient records, billing, prescriptions and analytics — beautifully designed
          for Indian clinics, in English, Hindi and Marathi.
        </p>
        <div className="shape-chips">
          {ORDER.map((s, i) => (
            <button
              key={s.id}
              className={'schip' + (i === shapeIdx ? ' on' : '')}
              onClick={() => poke(i)}
              title={SHAPE_NAMES[s.id]}
            >
              <span className="sce">{s.icon}</span>
              <span>{s.tag}</span>
            </button>
          ))}
        </div>
        <div className="hero-cta">
          <button className="btn" onClick={onRegister}>
            Start free trial →
          </button>
          <a className="btn ghost" href="#sec-demo">
            ▶ Watch it in action
          </a>
        </div>
        <div className="trustbar pilot">
          <span className="pilot-badge"><i>✓</i> PILOT CLINIC</span>
          <span className="pilot-name">Smile Catchers Dental, Pune</span>
        </div>
        <div className="hero-note">
          <span className="pulse-dot"></span>
          <span>{SHAPE_NAMES[ORDER[shapeIdx].id]}</span>
          <span style={{ opacity: 0.6 }}>· tap the anatomy or pick a shape</span>
        </div>
      </div>
      <div className="scroll-hint">Scroll</div>
    </header>
  )
}
