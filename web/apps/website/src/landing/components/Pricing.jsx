const PLANS = [
  {
    h: 'Starter', sub: 'For new single-doctor clinics', pr: '₹0', per: '/forever',
    feats: ['Up to 200 patients', 'Appointments & billing', '1 doctor seat'],
    cta: 'Start free', hot: false,
  },
  {
    h: 'Pro', sub: 'For growing clinics', pr: '₹1,499', per: '/month',
    feats: ['Unlimited patients', 'WhatsApp reminders', 'Up to 10 staff seats', 'Analytics & reports'],
    cta: 'Start 14-day trial', hot: true,
  },
  {
    h: 'Enterprise', sub: 'For hospitals & chains', pr: 'Custom', per: '',
    feats: ['Multi-branch dashboard', 'SSO & audit logs', 'Dedicated manager'],
    cta: 'Talk to sales', hot: false,
  },
]

export default function Pricing({ onRegister }) {
  return (
    <section className="chapter ch-dark" id="sec-price">
      <div className="wrap">
        <div className="eyebrow rv">Pricing</div>
        <h2 className="sec-title rv">
          Honest pricing, <span style={{ color: 'var(--ac)' }}>per clinic.</span>
        </h2>
        <p className="sec-sub rv">Start free. Upgrade when you're growing. No per-patient fees, ever.</p>
        <div className="pgrid">
          {PLANS.map((p) => (
            <div className={'pcard rv' + (p.hot ? ' featured' : '')} key={p.h}>
              {p.hot && <span className="phot">MOST POPULAR</span>}
              <h3>{p.h}</h3>
              <p className="psub">{p.sub}</p>
              <div className="pr">{p.pr}<span>{p.per}</span></div>
              <ul>
                {p.feats.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
              <button className={p.hot ? 'btn' : 'btn ghost'} style={{ width: '100%', justifyContent: 'center' }} onClick={onRegister}>
                {p.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
