const SPECS = [
  { emo: '🦷', h: 'Dental', p: '32-tooth FDI chart, treatment plans, lab work tracking.', bg: 'linear-gradient(150deg,#0d3b2e,#07130e)' },
  { emo: '🧴', h: 'Dermatology', p: 'Lesion photo timelines, procedure consent flows.', bg: 'linear-gradient(150deg,#3b1f2e,#130a10)' },
  { emo: '🧒', h: 'Paediatrics', p: 'Growth charts, vaccination schedules, parent updates.', bg: 'linear-gradient(150deg,#2e2a08,#100d04)' },
  { emo: '🩺', h: 'General practice', p: 'Fast OPD billing, chronic-care follow-up lists.', bg: 'linear-gradient(150deg,#1c2a3b,#080d14)' },
]

export default function Specialties() {
  return (
    <section className="chapter" id="sec-spec">
      <div className="wrap">
        <div className="eyebrow rv">Specialities</div>
        <h2 className="sec-title rv">
          Tuned for how <span style={{ color: 'var(--ac)' }}>you practise.</span>
        </h2>
        <p className="sec-sub rv">Speciality-specific charts, templates and workflows out of the box.</p>
        <div className="sgrid">
          {SPECS.map((s) => (
            <div className="scard rv" key={s.h} style={{ background: s.bg }}>
              <div className="emo">{s.emo}</div>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
