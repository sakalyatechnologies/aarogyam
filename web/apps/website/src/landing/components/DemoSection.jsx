import { useEffect, useRef, useState } from 'react'

const STEP_COUNT = { mobile: 8, web: 6 }
const FIRST_STEP = {
  t: 'Clinic overview',
  d: 'Today\u2019s schedule, chair status, revenue mix \u2014 the web command center.',
}
const DESK_W = 1280
const DESK_H = 800

export default function DemoSection() {
  const [tab, setTab] = useState('web')
  const [paused, setPaused] = useState(false)
  const [step, setStep] = useState({ i: 0, n: STEP_COUNT.web, ...FIRST_STEP })
  const [isMobile, setIsMobile] = useState(false)
  const [deskScale, setDeskScale] = useState(0.3)
  const [isFs, setIsFs] = useState(false)
  const mobileRef = useRef(null)
  const webRef = useRef(null)
  const deskWrapRef = useRef(null)
  const tabRef = useRef(tab)
  const pausedRef = useRef(paused)
  const isMobileRef = useRef(isMobile)
  tabRef.current = tab
  pausedRef.current = paused
  isMobileRef.current = isMobile

  useEffect(() => {
    const onR = () => setIsMobile(window.innerWidth <= 720)
    onR()
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])

  useEffect(() => {
    const measure = () => {
      if (deskWrapRef.current) setDeskScale(deskWrapRef.current.clientWidth / DESK_W)
    }
    measure()
    window.addEventListener('resize', measure)
    const t = setTimeout(measure, 400)
    return () => {
      window.removeEventListener('resize', measure)
      clearTimeout(t)
    }
  }, [tab, isMobile, isFs])

  const cmd = (m) => {
    try {
      const fr = tabRef.current === 'mobile' ? mobileRef.current : webRef.current
      fr?.contentWindow.postMessage(m, '*')
    } catch { /* noop */ }
  }

  useEffect(() => {
    const onMsg = (e) => {
      if (e.data && e.data.tourUser) {
        pausedRef.current = true
        setPaused(true)
        return
      }
      const s = e.data && e.data.tourStep
      if (s) {
        if (s.demo !== tabRef.current) return
        setStep({ i: s.i, n: s.n, t: s.t, d: s.d })
        return
      }
      const h = e.data && e.data.tourHeight
      if (h) {
        if (h.demo === 'web' && isMobileRef.current) return // scaled preview controls its own height
        const fr = h.demo === 'mobile' ? mobileRef.current : webRef.current
        if (fr && h.h > 400) fr.style.height = h.h + 'px'
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const switchTab = (t) => {
    if (t === tabRef.current) return
    cmd('tour-pause')
    tabRef.current = t
    setTab(t)
    setStep({ i: 0, n: STEP_COUNT[t], ...FIRST_STEP })
    setTimeout(() => {
      try {
        const fr = t === 'mobile' ? mobileRef.current : webRef.current
        fr.contentWindow.postMessage({ tourGo: 0 }, '*')
        if (!pausedRef.current) fr.contentWindow.postMessage('tour-play', '*')
      } catch { /* noop */ }
    }, 60)
  }

  const togglePause = () => {
    const next = !pausedRef.current
    pausedRef.current = next
    setPaused(next)
    cmd(next ? 'tour-pause' : 'tour-play')
  }

  const toggleFs = () => {
    const el = document.getElementById('demoFrame')
    if (document.fullscreenElement) { document.exitFullscreen(); return }
    if (isFs) { setIsFs(false); return }
    if (el && el.requestFullscreen && !isMobileRef.current) {
      el.requestFullscreen().catch(() => setIsFs(true))
    } else setIsFs(true)
  }

  useEffect(() => {
    document.body.classList.toggle('demo-fs-lock', isFs)
    if (!isFs) return
    const key = (e) => { if (e.key === 'Escape') setIsFs(false) }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('demo-fs-lock') }
  }, [isFs])

  const webScaled = isMobile && tab === 'web'

  return (
    <section className="chapter ch-dark" id="sec-demo">
      <div className="wrap">
        <div className="eyebrow rv">See it in action</div>
        <h2 className="sec-title rv">
          Watch it work. <span style={{ color: 'var(--ac)' }}>Then drive it.</span>
        </h2>
        <p className="sec-sub rv">
          The real product, on auto-play — sit back and watch it loop. Want to click around yourself?
          Pause and explore: every screen is live.
        </p>

        <div className="showcase rv">
          <h2 className="sh-title">{step.t}</h2>
          <p className="sh-desc">{step.d}</p>
          <div className="sdots">
            {Array.from({ length: step.n }, (_, k) => (
              <span
                key={k}
                className={'sdot' + (k === step.i ? ' on' : '')}
                onClick={() => cmd({ tourGo: k })}
              >
                <i />
              </span>
            ))}
          </div>
          <p className="demo-hint">Two demos, one screen — auto-play the tour, or pause and tap around yourself</p>
        </div>

        <div className="demotabs rv">
          <button className={'demotab' + (tab === 'web' ? ' on' : '')} onClick={() => switchTab('web')}>
            <span className="dt-ic">🖥️</span>
            <span className="dt-tx"><b>Web dashboard</b><i>The full clinic command center</i></span>
            {tab === 'web' && <span className="dt-live"><span className="queue-dot" style={{ background: 'var(--ok)' }}></span>LIVE</span>}
          </button>
          <button className={'demotab' + (tab === 'mobile' ? ' on' : '')} onClick={() => switchTab('mobile')}>
            <span className="dt-ic">📱</span>
            <span className="dt-tx"><b>Mobile app</b><i>The clinic in your pocket</i></span>
            {tab === 'mobile' && <span className="dt-live"><span className="queue-dot" style={{ background: 'var(--ok)' }}></span>LIVE</span>}
          </button>
        </div>

        <div
          className={'demoframe rv' + (isFs ? ' is-fs' : '')}
          id="demoFrame"
          onMouseEnter={() => { if (!pausedRef.current) cmd('tour-pause') }}
          onMouseLeave={() => { if (!pausedRef.current) cmd('tour-play') }}
          onTouchStart={(e) => {
            if (!pausedRef.current && !e.target.closest('.dbar')) {
              pausedRef.current = true
              setPaused(true)
              cmd('tour-pause')
            }
          }}
        >
          <div className="dbar">
            <div className="url">🔒 preview.aarogyam.in/live-demo</div>
              <div className="livechip">
            <span className="badge b-ok">
              <span className="queue-dot" style={{ background: 'var(--ok)' }}></span>
              <span>{paused ? 'MANUAL · tap around, it’s all live' : 'AUTO-PLAY · tap anything, it’s live'}</span>
            </span>
          </div>
            <div className="dbar-actions">
              <button className="pill" onClick={togglePause}>
                {paused ? '▶ Auto-play' : '⏸ Pause'}
              </button>
              <button className="pill" onClick={toggleFs}>
                {isFs ? '✕ Exit full screen' : '⛶ Full screen'}
              </button>
            </div>
          </div>
          <iframe
            ref={mobileRef}
            src="/demos/mobile.html"
            title="Aarogyam mobile app — interactive mockups"
            style={{ display: tab === 'mobile' ? 'block' : 'none' }}
          />
          {webScaled ? (
            <div className="deskprev" ref={deskWrapRef} style={{ display: tab === 'web' ? 'block' : 'none' }}>
              <div className="deskprev-bar">
                <i /><i /><i />
                <span>🔒 preview.aarogyam.in/dashboard · desktop preview</span>
              </div>
              <div className="deskprev-view" style={{ height: Math.round(DESK_H * deskScale) }}>
                <iframe
                  ref={webRef}
                  src="/demos/web.html"
                  title="Aarogyam web dashboard — desktop preview"
                  style={{ width: DESK_W, height: DESK_H, transform: `scale(${deskScale})` }}
                />
              </div>
              <p className="deskprev-note">
                Desktop dashboard, auto-playing above · tap the dots to jump chapters · best explored on a larger screen
              </p>
            </div>
          ) : (
            <iframe
              ref={webRef}
              src="/demos/web.html"
              title="Aarogyam web dashboard — interactive demo"
              style={{ display: tab === 'web' ? 'block' : 'none' }}
            />
          )}
        </div>

        <p className="demo-note rv">
          Two ways to experience it: leave <b>auto-play</b> on for the guided tour, or hit{' '}
          <b>pause</b> and tap around yourself — search patients, roll the theme dice, try dark mode.
        </p>
      </div>
    </section>
  )
}
