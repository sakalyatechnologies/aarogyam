import { LeafMark } from './Nav.jsx'

export function Testimonial() {
  return (
    <section className="chapter" style={{ paddingTop: 20 }}>
      <div className="wrap">
        <div className="quote rv">
          <p>"We replaced four registers and two Excel sheets with Aarogyam in a weekend. My receptionist cried happy tears."</p>
          <b>Dr. Meera Shah</b>
          <span>Smile Care Dental, Mumbai · 4,800 patients</span>
        </div>
      </div>
    </section>
  )
}

export function Cta({ onRegister, onSignIn }) {
  return (
    <section className="chapter ch-dark" style={{ paddingTop: 20 }}>
      <div className="wrap">
        <div className="cta rv" id="cta">
          <h2>
            Your clinic, <span style={{ color: 'var(--ac)' }}>upgraded.</span>
          </h2>
          <p>Now onboarding pilot clinics. Free to start, live in a day.</p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', position: 'relative' }}>
            <button className="btn" style={{ fontSize: 16, padding: '16px 40px' }} onClick={onRegister}>
              Get started free →
            </button>
            <button className="btn ghost" style={{ fontSize: 16, padding: '16px 40px' }} onClick={onSignIn}>
              Sign in
            </button>
          </div>
        </div>
        <footer className="site-foot">
          <div className="fcols">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <LeafMark size={34} />
                <b className="font-d" style={{ color: 'var(--txt)', fontSize: 16 }}>Aarogyam</b>
              </div>
              <p style={{ lineHeight: 1.7, maxWidth: 280, color: 'var(--mut)', fontSize: 14 }}>
                The clinic OS for modern India. Built by{' '}
                <a href="https://www.sakalyatechnologies.com/" target="_blank" rel="noreferrer" style={{ display: 'inline', color: 'var(--ac)', margin: 0 }}>
                  Sakalya Technologies
                </a>
                , Mumbai.
              </p>
            </div>
            <div>
              <h5>PRODUCT</h5>
              <a href="#sec-feat">Features</a>
              <a href="#sec-spec">Specialities</a>
              <a href="#sec-demo">Live demo</a>
            </div>
            <div>
              <h5>COMPANY</h5>
              <a href="#top">About</a>
              <a href="https://www.sakalyatechnologies.com/" target="_blank" rel="noreferrer">Sakalya Technologies ↗</a>
              <a href="#top">Careers</a>
              <a href="#top">Press</a>
            </div>
            <div>
              <h5>ACCOUNT</h5>
              <a href="#top" onClick={(e) => { e.preventDefault(); onSignIn() }}>Sign in</a>
              <a href="#top" onClick={(e) => { e.preventDefault(); onRegister() }}>Request access</a>
            </div>
          </div>
          <div className="fbase">
            <span>© 2026 Sakalya Technologies · DPDP compliant · ISO 27001</span>
            <span>Made with care in Mumbai 🇮🇳</span>
          </div>
        </footer>
      </div>
    </section>
  )
}
