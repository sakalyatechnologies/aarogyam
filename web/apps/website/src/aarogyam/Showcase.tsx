// Aarogyam-owned. A product preview in the portal's V4 look (deep green, warm amber, clean cards).
// All people, numbers and drugs are synthetic.
import "./v4.css";

const TEETH = [
  { n: "16", m: "gic" }, { n: "15", m: "" }, { n: "14", m: "comp" }, { n: "13", m: "" },
  { n: "12", m: "" }, { n: "11", m: "crown" }, { n: "21", m: "crown" }, { n: "22", m: "" },
] as const;

const POINTS = [
  { title: "Dental chart with materials", text: "Tap a tooth, record the work and the material used. Stock follows." },
  { title: "Prescriptions with allergy checks", text: "Allergies and clashes are flagged before a prescription is signed." },
  { title: "Billing and GST", text: "Itemised bills, GST invoices and pending payments in one place." },
];

function Tooth({ n, m }: { n: string; m: string }) {
  return (
    <li className={`v4-tooth ${m ? `mat-${m}` : ""}`}>
      <svg viewBox="0 0 24 30" aria-hidden="true">
        <path d="M5 4c3-2 11-2 14 0 2 3 1 8-1 12-1 4-1 9-3 10-2 0-1-5-3-5s-1 5-3 5c-2-1-2-6-3-10-2-4-3-9-1-12z" />
      </svg>
      <span>{n}</span>
    </li>
  );
}

export function Showcase({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`v4-show ${compact ? "compact" : ""}`} aria-label="Aarogyam product preview">
      <div className="v4-show-head">
        <span className="v4-mark" aria-hidden="true">SD</span>
        <div><b>Sunrise Dental</b><small>Aarogyam Clinic OS</small></div>
      </div>
      <h2 className="v4-show-title">See the whole day, and every patient, at a glance.</h2>

      <div className="v4-window" role="img" aria-label="Preview of the Today screen with the next consultation, a dental chart, a prescription and a bill. Sample data.">
        <div className="v4-today">
          <p className="v4-eyebrow">Wednesday · Today</p>
          <p className="v4-greet">Good morning, Asha.</p>
          <div className="v4-next">
            <small>Next consultation · 11:30 am</small>
            <b>Fatima Thakur</b>
            <span>Scaling and polishing · Chair 2</span>
            <div className="v4-ring"><b>3</b>/14 done</div>
          </div>
          <ul className="v4-stats">
            <li><small>Appointments</small><b>14</b></li>
            <li><small>Waiting</small><b>2</b></li>
            <li><small>Revenue</small><b>₹18.4k</b></li>
          </ul>
        </div>

        <div className="v4-p360">
          <div className="v4-p360-top">
            <span className="v4-av">AD</span>
            <div><small>Patient 360</small><b>Aakash D&apos;Souza</b></div>
            <span className="v4-flag">Allergy: penicillin</span>
          </div>
          <ul className="v4-teeth" aria-hidden="true">{TEETH.map((t) => <Tooth key={t.n} {...t} />)}</ul>
          <ul className="v4-legend" aria-hidden="true">
            <li className="mat-gic">GIC filling</li><li className="mat-comp">Composite A2</li><li className="mat-crown">Zirconia crown</li>
          </ul>
          <div className="v4-rx"><b>Rx</b> Amoxicillin 500 mg <span className="v4-warn">Blocked: penicillin allergy</span></div>
          <div className="v4-bill"><span>Invoice SD-1042</span><b>₹4,720</b><i>incl. GST 18%</i></div>
        </div>
      </div>

      <ul className="v4-points">
        {POINTS.map((p) => (
          <li key={p.title}><b>{p.title}</b><span>{p.text}</span></li>
        ))}
      </ul>
    </section>
  );
}
