const FEATS = [
  { ic: '📅', bg: 'rgba(16,217,160,.13)', h: 'Smart scheduling', p: 'OPD queues, appointments and reminders on SMS + WhatsApp. No-shows drop by 40%.' },
  { ic: '🧑‍⚕️', bg: 'rgba(139,123,255,.13)', h: 'Patient 360', p: 'Every visit, x-ray, prescription and payment on one timeline. Including a 32-tooth dental chart.' },
  { ic: '🧾', bg: 'rgba(242,193,78,.13)', h: 'Billing & payments', p: 'GST invoices, UPI collection links and overdue tracking — money in, minus the chasing.' },
  { ic: '💊', bg: 'rgba(76,195,255,.13)', h: 'E-prescriptions', p: "Digital prescriptions with allergy checks, sent to the patient's phone in seconds." },
  { ic: '📊', bg: 'rgba(255,107,139,.13)', h: 'Clinic analytics', p: 'Revenue, footfall and doctor performance — the numbers that actually matter, live.' },
  { ic: '🏥', bg: 'rgba(255,176,32,.13)', h: 'Multi-branch', p: 'One dashboard across all your locations, with role-based access for every staff member.' },
  { ic: '🎙️', bg: 'rgba(16,217,160,.13)', h: 'Voice notes', p: 'Tap the consult mic, talk naturally while examining — Aarogyam transcribes straight into chief complaint and findings. No typing mid-consultation.' },
  { ic: '🌐', bg: 'rgba(139,123,255,.13)', h: 'Free clinic website', p: 'We design and launch your clinic website — branding, WhatsApp booking, Google Maps — at zero extra cost. Complimentary with Aarogyam.' },
]

export default function Features() {
  return (
    <section className="chapter" id="sec-feat">
      <div className="wrap">
        <div className="eyebrow rv">Product</div>
        <h2 className="sec-title rv">
          Everything a clinic needs. <span style={{ color: 'var(--ac)' }}>Nothing it doesn't.</span>
        </h2>
        <p className="sec-sub rv">One subscription replaces the registers, the Excel sheets and the five different apps.</p>
        <div className="fgrid">
          {FEATS.map((f) => (
            <div className="feat rv" key={f.h}>
              <div className="ic" style={{ background: f.bg }}>{f.ic}</div>
              <h3>{f.h}</h3>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
