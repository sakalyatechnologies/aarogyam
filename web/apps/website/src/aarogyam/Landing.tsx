// Aarogyam-owned landing page: a product-first hero and tour in the portal's V4 look, then the
// Lovable sections unchanged. Only src/routes/index.tsx (patched) points here.
import "./v4.css";
import patientImg from "./product/patient.png";
import todayImg from "./product/today.png";
import billingImg from "./product/billing.png";
import Marquee from "@/landing/components/Marquee.jsx";
import Features from "@/landing/components/Features.jsx";
import DemoSection from "@/landing/components/DemoSection.jsx";
import Specialties from "@/landing/components/Specialties.jsx";
import FreeSite from "@/landing/components/FreeSite.jsx";
// Named exports exist at runtime; the shared *.jsx typing only declares a default.
// @ts-expect-error TS2614
import { Testimonial, Cta } from "@/landing/components/Closing.jsx";

const TOUR = [
  { img: patientImg, title: "Patient 360", alt: "Patient 360 screen for a sample patient with tabs for chart, visits, prescriptions, files and billing", text: "Chart, visits, prescriptions, files and billing for one patient, on one screen." },
  { img: todayImg, title: "Today", alt: "Today screen with the next consultation, queue, chair status and appointments by hour", text: "The day at a glance: who is next, who is waiting, which chair is free." },
  { img: billingImg, title: "Billing and GST", alt: "Billing screen with invoices, pending payments and GST totals", text: "Itemised bills, GST invoices and what is still pending." },
];

export function Landing({ onRegister, onSignIn }: { onRegister: () => void; onSignIn: () => void }) {
  return (
    <>
      <header className="v4-hero" id="top">
        <div className="wrap v4-hero-grid">
          <div>
            <span className="v4-eyebrow-pill">Clinic OS · In active pilot</span>
            <h1>Run your entire clinic from <em>one calm place.</em></h1>
            <p className="v4-lede">
              Appointments, patient records, dental charts with materials, prescriptions with allergy checks, and billing
              with GST, built for Indian clinics.
            </p>
            <div className="v4-cta-row">
              <button className="v4-cta primary" onClick={onRegister}>Request access →</button>
              <button className="v4-cta ghost" onClick={onSignIn}>Sign in</button>
            </div>
            <p className="v4-trust">Pilot clinic: Smile Catchers Dental, Pune</p>
          </div>
          <figure className="v4-shot">
            <img src={todayImg} width={1400} height={875} alt="Aarogyam Today screen: next consultation, waiting patients, chair status and appointments by hour (sample data)" fetchPriority="high" />
          </figure>
        </div>
      </header>
      <section className="v4-tour" id="product">
        <div className="wrap">
          <h2>Everything the front desk and the chair need.</h2>
          <p className="v4-sub">Real screens from the product, shown with sample data.</p>
          <div className="v4-tour-grid">
            {TOUR.map((t) => (
              <article className="v4-card" key={t.title}>
                <figure className="v4-shot"><img src={t.img} alt={t.alt} loading="lazy" /></figure>
                <div className="v4-card-t"><h3>{t.title}</h3><p>{t.text}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <Marquee />
      <Features />
      <DemoSection />
      <Specialties />
      <FreeSite onRegister={onRegister} />
      <Testimonial />
      <Cta onRegister={onRegister} onSignIn={onSignIn} />
    </>
  );
}
