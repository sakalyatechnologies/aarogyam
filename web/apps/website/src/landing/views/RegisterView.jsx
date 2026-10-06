import { useState } from 'react'
import { submitRegistration } from '../../aarogyam/api.ts'

const ROLES = ['Doctor', 'Receptionist', 'Clinic manager', 'Other staff']
const SPECS = ['General Dentistry', 'Orthodontics', 'Implantology', 'Dermatology', 'Paediatrics', 'General practice', 'Other']

export default function RegisterView({ onBack, onSignIn }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', role: ROLES[0], spec: SPECS[0], clinic: '', city: '', lic: '' })
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async () => {
    if (!f.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) || !f.phone.trim() || !f.clinic.trim() || !f.city.trim()) {
      setErr('Please fill name, a valid email, phone, clinic name and city.')
      return
    }
    setErr('')
    setBusy(true)
    const out = await submitRegistration(f)
    setBusy(false)
    if (out.ok) setDone(out.value)
    else setErr(out.message)
  }

  if (done)
    return (
      <div className="auth-page">
        <div className="wrap">
          <button className="backlink" onClick={onBack}>← aarogyam.in</button>
          <div className="auth-card rv in" style={{ textAlign: 'center' }}>
            <div className="done-ic" style={{ margin: '0 auto' }}>🎉</div>
            <h2 className="font-d" style={{ marginTop: 16 }}>Application sent</h2>
            <p className="auth-sub">{done}</p>
            <p className="auth-note">Our team reviews every application personally. Watch your inbox for the invitation.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
              <button className="btn ghost" onClick={onBack}>← Back to site</button>
            </div>
          </div>
        </div>
      </div>
    )

  return (
    <div className="auth-page">
      <div className="wrap">
        <button className="backlink" onClick={onBack}>← Back to site</button>
        <div className="auth-card rv in">
          <div className="eyebrow">Request access</div>
          <h2 className="font-d">Application form 📝</h2>
          <p className="auth-sub">Tell us about your practice. Approvals are manual for now — no payment needed.</p>
          <div className="fgrid2">
            <div className="field"><label>Full name *</label><input value={f.name} onChange={set('name')} placeholder="Dr. Asha Kulkarni" /></div>
            <div className="field"><label>Email *</label><input value={f.email} onChange={set('email')} placeholder="you@clinic.in" /></div>
            <div className="field"><label>Phone *</label><input value={f.phone} onChange={set('phone')} placeholder="+91 98200 12345" /></div>
            <div className="field"><label>Role</label>
              <select value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            </div>
            <div className="field"><label>Speciality</label>
              <select value={f.spec} onChange={set('spec')}>{SPECS.map((r) => <option key={r}>{r}</option>)}</select>
            </div>
            <div className="field"><label>Clinic name *</label><input value={f.clinic} onChange={set('clinic')} placeholder="Smile Care Dental" /></div>
            <div className="field"><label>City *</label><input value={f.city} onChange={set('city')} placeholder="Mumbai" /></div>
            <div className="field"><label>Medical license no.</label><input value={f.lic} onChange={set('lic')} placeholder="MCI-2019-88412" /></div>
          </div>
          {err && <p className="auth-err">{err}</p>}
          <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} onClick={submit} disabled={busy}>
            {busy ? 'Sending…' : 'Submit application →'}
          </button>
          <p className="auth-note">Already approved? <a onClick={onSignIn} style={{ cursor: 'pointer', color: 'var(--ac)' }}>Sign in</a></p>
        </div>
      </div>
    </div>
  )
}
