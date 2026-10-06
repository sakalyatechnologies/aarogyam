import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import Nav from './components/Nav.jsx'
import { applyTheme, applyMode } from './engine/theme.js'

// Shared chrome for the public site: floating nav, live theme, scroll reveals.
export default function Shell({ children }) {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [accentName, setAccentName] = useState('tulsi')
  const [mode, setMode] = useState('dark')

  useEffect(() => {
    const savedA = localStorage.getItem('ag-accent')
    const savedM = localStorage.getItem('ag-mode')
    if (savedA) { setAccentName(savedA.startsWith('#') ? 'custom' : savedA); applyTheme(savedA) } else applyTheme('tulsi')
    if (savedM) { setMode(savedM); applyMode(savedM) } else applyMode('dark')
  }, [])

  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((x) => x.isIntersecting && x.target.classList.add('in')),
      { threshold: 0.12 }
    )
    const scan = () => document.querySelectorAll('.rv:not([data-obs])').forEach((el) => { el.dataset.obs = '1'; io.observe(el) })
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { io.disconnect(); mo.disconnect() }
  }, [pathname])

  const goSection = useCallback((id) => {
    const scroll = () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    if (pathname !== '/') { navigate({ to: '/' }).then(() => setTimeout(scroll, 120)) } else scroll()
  }, [pathname, navigate])

  return (
    <>
      <Nav
        accentName={accentName}
        onPick={(n) => { setAccentName(n); applyTheme(n); localStorage.setItem('ag-accent', n) }}
        onPickCustom={(hex) => { setAccentName('custom'); applyTheme(hex); localStorage.setItem('ag-accent', hex) }}
        mode={mode}
        onToggleMode={() => { const m = mode === 'dark' ? 'light' : 'dark'; setMode(m); applyMode(m); localStorage.setItem('ag-mode', m) }}
        onLogo={() => navigate({ to: '/' })}
        onLink={goSection}
        onSignIn={() => navigate({ to: '/sign-in' })}
        onRegister={() => navigate({ to: '/register' })}
      />
      {children}
    </>
  )
}
