import { CalendarCheck, CheckCircle2, ShieldCheck, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";

export interface AuthShellProps {
  /** The product name, such as "Aarogyam" or "Sakalya Console". */
  name: string;
  /** A short line under the name. */
  tagline: string;
  /** The brand mark's icon. */
  icon: ReactNode;
  /** The headline on the visual side (large screens only). */
  headline: string;
  /** Short selling points beside the visual. */
  points: readonly string[];
  /** Which product picture to show. */
  visual: "clinic" | "console";
  /** The form side. */
  children: ReactNode;
  footer?: ReactNode;
}

function BrandMark({ name, tagline, icon, onDark = false }: Pick<AuthShellProps, "name" | "tagline" | "icon"> & { onDark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex size-11 items-center justify-center rounded-2xl ${onDark ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-primary text-on-primary"}`}
      >
        {icon}
      </span>
      <div className="leading-tight">
        <p className={`text-lg font-extrabold tracking-tight ${onDark ? "text-white" : "text-text"}`}>{name}</p>
        <p className={`text-xs ${onDark ? "text-white/70" : "text-muted"}`}>{tagline}</p>
      </div>
    </div>
  );
}

/** A decorative "today" screen: three appointments and two figures, all made up. */
export function ClinicVisual() {
  const rows = [
    { time: "10:00", name: "Meera S.", what: "Check-up", tag: "In chair", tone: "bg-emerald-400/90" },
    { time: "10:30", name: "Arjun P.", what: "Root canal, visit 2", tag: "Waiting", tone: "bg-amber-300/90" },
    { time: "11:15", name: "Kavya R.", what: "Scaling", tag: "Booked", tone: "bg-sky-300/90" },
  ] as const;
  return (
    <div aria-hidden="true" className="relative mx-auto mt-10 w-full max-w-md">
      <div className="rounded-3xl bg-white/95 p-5 text-slate-800 shadow-2xl ring-1 ring-black/5">
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-extrabold">
            <CalendarCheck className="size-4 text-primary" /> Today
          </p>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">Thu 3 Oct</span>
        </div>
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.time} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
              <span className="w-11 text-xs font-bold text-slate-500">{row.time}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{row.name}</span>
                <span className="block truncate text-xs text-slate-500">{row.what}</span>
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <span className={`size-2 rounded-full ${row.tone}`} />
                {row.tag}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="absolute -top-5 -right-3 flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2 text-slate-800 shadow-xl">
        <Stethoscope className="size-4 text-primary" />
        <span className="text-xs font-extrabold">12 patients today</span>
      </div>
      <div className="absolute -bottom-5 -left-3 rounded-2xl bg-white px-3.5 py-2 text-slate-800 shadow-xl">
        <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Collected</p>
        <p className="text-sm font-extrabold">₹18,400</p>
      </div>
    </div>
  );
}

/** A decorative latency chart with a budget line and two health figures, all made up. */
export function ConsoleVisual() {
  return (
    <div aria-hidden="true" className="relative mx-auto mt-10 w-full max-w-md">
      <div className="rounded-3xl bg-white/95 p-5 text-slate-800 shadow-2xl ring-1 ring-black/5">
        <p className="mb-3 flex items-center gap-2 text-sm font-extrabold">
          <ShieldCheck className="size-4 text-primary" /> Service health
        </p>
        <svg viewBox="0 0 320 120" className="h-auto w-full">
          {[20, 50, 80].map((y) => (
            <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="#e2e8f0" />
          ))}
          <line x1="0" x2="320" y1="36" y2="36" stroke="#be123c" strokeDasharray="5 4" />
          <polyline fill="none" stroke="#1b734a" strokeWidth="2.5" strokeLinejoin="round" points="0,86 30,80 60,84 90,70 120,76 150,62 180,68 210,50 240,58 270,54 320,60" />
          <polyline fill="none" stroke="#4338ca" strokeWidth="2" strokeDasharray="6 4" points="0,100 30,98 60,101 90,95 120,99 150,92 180,96 210,88 240,92 270,90 320,94" />
        </svg>
        <p className="mt-2 text-[11px] font-semibold text-slate-500">p95 latency against its budget</p>
      </div>
      <div className="absolute -top-5 -right-3 flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2 text-slate-800 shadow-xl">
        <CheckCircle2 className="size-4 text-emerald-600" />
        <span className="text-xs font-extrabold">99.9% success</span>
      </div>
      <div className="absolute -bottom-5 -left-3 rounded-2xl bg-white px-3.5 py-2 text-slate-800 shadow-xl">
        <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">p95</p>
        <p className="text-sm font-extrabold">182 ms</p>
      </div>
    </div>
  );
}

/**
 * The page around every sign-in and registration screen: on large screens a product picture
 * beside the form, on phones a compact brand header above it. The picture is decoration only.
 */
export function AuthShell({ name, tagline, icon, headline, points, visual, children, footer }: AuthShellProps) {
  return (
    <main className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden px-10 py-10 text-white lg:flex xl:px-14"
        style={{ background: "linear-gradient(150deg, var(--sk-primary), color-mix(in srgb, var(--sk-primary) 45%, #020b07))" }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full bg-black/20 blur-3xl"
        />
        <div className="relative">
          <BrandMark name={name} tagline={tagline} icon={icon} onDark />
        </div>
        <div className="relative my-10">
          <h2 className="max-w-md text-3xl font-extrabold tracking-tight xl:text-4xl">{headline}</h2>
          {visual === "clinic" ? <ClinicVisual /> : <ConsoleVisual />}
        </div>
        <ul className="relative flex flex-col gap-2 text-sm text-white/85">
          {points.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-white" />
              {point}
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex flex-col items-center justify-center bg-background px-4 py-8 sm:px-8">
        <div className="mb-6 w-full max-w-md lg:hidden">
          <BrandMark name={name} tagline={tagline} icon={icon} />
        </div>
        <div className="w-full max-w-md">{children}</div>
        {footer === undefined ? null : <div className="mt-8 w-full max-w-md text-xs text-muted">{footer}</div>}
      </div>
    </main>
  );
}

export interface AuthStepsProps {
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
  label?: string;
}

/** "1 Email — 2 Code" progress, with the current step marked for screen readers. */
export function AuthSteps({ steps, current, label = "Progress" }: AuthStepsProps) {
  return (
    <ol aria-label={label} className="m-0 mb-6 flex list-none items-center gap-2 p-0">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} aria-current={active ? "step" : undefined} className="flex flex-1 flex-col gap-1.5">
            <span className={`h-1.5 rounded-full ${done || active ? "bg-primary" : "bg-border"}`} />
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${active ? "text-text" : "text-muted"}`}>
              <span
                aria-hidden="true"
                className={`flex size-4 items-center justify-center rounded-full text-[10px] font-bold ${done || active ? "bg-primary text-on-primary" : "bg-surface-muted text-muted"}`}
              >
                {index + 1}
              </span>
              {step}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A form's heading and one line under it. */
export function AuthHeading({ title, subtitle, id }: { title: string; subtitle?: ReactNode; id?: string }) {
  return (
    <div className="mb-5">
      <h1 id={id} className="text-2xl font-extrabold tracking-tight text-text sm:text-3xl">
        {title}
      </h1>
      {subtitle === undefined ? null : <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}
