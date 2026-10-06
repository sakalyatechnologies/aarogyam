import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays, Users, Sparkles, Mic, Receipt, Package, MessageCircle, Smile, LayoutDashboard,
  Search, Plus, Wifi, WifiOff, X, AlertTriangle, ShieldCheck, Play, Square, Check, QrCode,
  FlaskConical, Send, Download, ChevronRight, ArrowLeft, Clock, FileText,
} from "lucide-react";
import { StatusBadge, type Status } from "@/components/site/primitives";
import {
  patients, schedule, hours, invoices, weekly, stock, labCases, templates, toothStates,
  type Patient, type ToothState, type ApptState,
} from "@/components/workspace/data";

export const Route = createFileRoute("/workspace")({
  head: () => ({
    meta: [
      { title: "Dentist workspace demo — Aarogyam" },
      { name: "description", content: "Try the dentist's day in Aarogyam: chairs, tooth chart, Patient 360, prescriptions, billing, stock, lab work and reminders." },
      { property: "og:title", content: "Dentist workspace demo — Aarogyam" },
      { property: "og:description", content: "An interactive tour of a dental clinic's day in Aarogyam, from the first chair to the last payment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/workspace" }],
  }),
  component: Workspace,
});

type Tab = "today" | "patients" | "chart" | "consult" | "calendar" | "billing" | "stock" | "messages";
const nav: { k: Tab; label: string; icon: ReactNode }[] = [
  { k: "today", label: "Today", icon: <LayoutDashboard className="size-4" /> },
  { k: "patients", label: "Patients", icon: <Users className="size-4" /> },
  { k: "chart", label: "Tooth chart", icon: <Smile className="size-4" /> },
  { k: "consult", label: "Consult & Rx", icon: <Mic className="size-4" /> },
  { k: "calendar", label: "Calendar", icon: <CalendarDays className="size-4" /> },
  { k: "billing", label: "Billing", icon: <Receipt className="size-4" /> },
  { k: "stock", label: "Stock & Lab", icon: <Package className="size-4" /> },
  { k: "messages", label: "Messages", icon: <MessageCircle className="size-4" /> },
];

function Workspace() {
  const [tab, setTab] = useState<Tab>("today");
  const [open, setOpen] = useState<Patient | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2400); };
  const openP = (name: string) => setOpen(patients.find((p) => p.n === name) ?? null);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="ws-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col p-4 text-forest-foreground lg:flex">
        <Link to="/" className="flex items-center gap-2.5 px-2 py-2">
          <span className="grid size-9 place-items-center rounded-xl bg-primary font-deva text-lg text-primary-foreground">आ</span>
          <span className="font-display text-xl">Aarogyam</span>
        </Link>
        <div className="mt-5 rounded-2xl bg-forest-foreground/10 p-3">
          <p className="text-sm font-medium">Smile Catchers</p>
          <p className="text-xs opacity-70">Dental · Baner, Pune</p>
        </div>
        <nav className="mt-5 flex flex-col gap-1">
          {nav.map((n) => (
            <button key={n.k} onClick={() => setTab(n.k)}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300 ${tab === n.k ? "bg-forest-foreground text-forest shadow-lg" : "opacity-80 hover:translate-x-1 hover:bg-forest-foreground/10 hover:opacity-100"}`}>
              {n.icon}{n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <button onClick={() => { setOnline(!online); say(online ? "Offline — today's queue keeps working" : "Back online — changes synced"); }}
            className="flex w-full items-center gap-2 rounded-xl bg-forest-foreground/10 px-3 py-2 text-xs">
            {online ? <Wifi className="size-4 text-fresh" /> : <WifiOff className="size-4 text-gold" />}
            {online ? "Online · synced" : "Offline · saving locally"}
          </button>
          <p className="px-2 font-deva text-sm text-gold">आरोग्यं धनसम्पदा</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="ws-glass sticky top-0 z-30 flex items-center gap-3 border-b border-border px-4 py-3 md:px-8">
          <Link to="/" className="rounded-full p-2 hover:bg-muted lg:hidden" aria-label="Back to site"><ArrowLeft className="size-4" /></Link>
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input placeholder="Search patients, file no…" onKeyDown={(e) => { if (e.key === "Enter") { const q = e.currentTarget.value.toLowerCase(); const p = patients.find((x) => (x.n + x.f).toLowerCase().includes(q)); if (p) setOpen(p); else say("No patient found"); } }}
              className="w-full rounded-full border border-input bg-surface py-2 pl-9 pr-4 text-sm outline-none transition focus:ring-2 focus:ring-ring/30" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => say("New appointment form opened")} className="hidden items-center gap-1.5 rounded-full border border-input bg-surface px-3 py-2 text-sm transition hover:-translate-y-0.5 sm:flex"><Plus className="size-4" />Appointment</button>
            <button onClick={() => setTab("consult")} className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"><Play className="size-4" />Start next visit</button>
            <span className="grid size-9 place-items-center rounded-full bg-gold-soft text-sm font-medium text-forest">DK</span>
          </div>
        </header>

        {/* Mobile tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2 lg:hidden">
          {nav.map((n) => (
            <button key={n.k} onClick={() => setTab(n.k)} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition ${tab === n.k ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{n.icon}{n.label}</button>
          ))}
        </div>

        <div key={tab} className="ws-in mx-auto max-w-7xl p-4 md:p-8">
          {tab === "today" && <Today openP={openP} go={setTab} say={say} />}
          {tab === "patients" && <PatientsTab openP={openP} />}
          {tab === "chart" && <ChartTab say={say} />}
          {tab === "consult" && <ConsultTab say={say} />}
          {tab === "calendar" && <CalendarTab say={say} />}
          {tab === "billing" && <BillingTab say={say} />}
          {tab === "stock" && <StockTab say={say} />}
          {tab === "messages" && <MessagesTab say={say} />}
        </div>
      </div>

      {open && <Drawer p={open} onClose={() => setOpen(null)} go={(t) => { setOpen(null); setTab(t); }} />}
      {toast && <div className="ws-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-forest px-5 py-2.5 text-sm text-forest-foreground shadow-xl">{toast}</div>}
    </div>
  );
}

/* ---------- helpers ---------- */
function Card({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return <div className={`ws-in rounded-3xl border border-border bg-card p-5 shadow-sm transition-shadow duration-300 hover:shadow-md ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>;
}
function H({ children, right, status }: { children: ReactNode; right?: ReactNode; status?: Status }) {
  return <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 className="font-display text-xl">{children}</h2>{status && <StatusBadge status={status} />}</div>{right}</div>;
}
function Count({ to, prefix = "", suffix = "" }: { to: number; prefix?: string; suffix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now(); let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 1100); setV(p >= 1 ? to : to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{prefix}{Math.round(v).toLocaleString("en-IN")}{suffix}</>;
}
const initials = (n: string) => n.split(" ").map((w) => w[0]).join("");
function Avatar({ n }: { n: string }) {
  return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{initials(n)}</span>;
}
const stateStyle: Record<ApptState, [string, string]> = {
  done: ["Done", "bg-muted text-muted-foreground"],
  chair: ["In chair", "bg-primary text-primary-foreground"],
  waiting: ["Waiting", "bg-gold-soft text-forest"],
  booked: ["Booked", "bg-secondary text-secondary-foreground"],
};
function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "muted" }) {
  const c = { ok: "bg-secondary text-secondary-foreground", warn: "bg-gold-soft text-forest", bad: "bg-destructive/10 text-destructive", muted: "bg-muted text-muted-foreground" }[tone];
  return <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${c}`}>{children}</span>;
}

/* ---------- Today ---------- */
function Today({ openP, go, say }: { openP: (n: string) => void; go: (t: Tab) => void; say: (m: string) => void }) {
  const max = Math.max(...hours.map((h) => h[1]));
  return (
    <div className="space-y-6">
      <div className="ws-in relative overflow-hidden rounded-[2rem] bg-forest p-6 text-forest-foreground md:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-primary/40 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 size-56 rounded-full bg-gold/20 blur-3xl" />
        <div className="relative grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest opacity-70">Saturday · 3 October · Smile Catchers</p>
            <h1 className="font-display mt-3 text-4xl md:text-5xl">Good morning, Dr. Kiran.</h1>
            <p className="mt-3 max-w-lg opacity-85">24 appointments, 2 patients waiting, 2 recalls due. Your next patient <b>Rohan Iyer</b> is ready for Chair 1 — his crown arrived from the lab this morning.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={() => go("consult")} className="flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-forest transition hover:-translate-y-0.5"><Play className="size-4" />Start Rohan's visit</button>
              <button onClick={() => openP("Rohan Iyer")} className="rounded-full border border-forest-foreground/30 px-5 py-2.5 text-sm transition hover:bg-forest-foreground/10">Open Patient 360</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[["Chair use", 92, "%"], ["Visits done", 14, " / 24"]].map(([l, v, s]) => (
              <div key={l as string} className="rounded-2xl bg-forest-foreground/10 p-4 backdrop-blur">
                <p className="font-mono text-3xl"><Count to={v as number} suffix={s as string} /></p>
                <p className="mt-1 text-xs opacity-70">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ws-in relative overflow-hidden rounded-3xl border border-gold/40 bg-gold-soft p-5" style={{ animationDelay: "80ms" }}>
        <div className="ws-shimmer pointer-events-none absolute inset-0" />
        <div className="relative flex gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-gold" />
          <div>
            <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-forest">Morning brief</p><StatusBadge status="Coming next" /></div>
            <p className="mt-1 text-sm text-forest/80">Two 6-month cleaning recalls are overdue (Meera S., Vikram R.). Chair 2 has a 40-minute gap at 1 PM. Composite A2 will run out in about 6 days. <span className="italic">Suggestions only — you decide.</span></p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[["Appointments", 24, "", "+3 walk-ins"], ["Waiting now", 2, "", "longest 12 min"], ["Collected today", 18400, "₹", "UPI 70%"], ["Pending", 12600, "₹", "6 bills"]].map(([l, v, pre, sub], i) => (
          <Card key={l as string} delay={120 + i * 60}>
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-2 font-mono text-2xl md:text-3xl"><Count to={v as number} prefix={pre as string} /></p>
            <p className="mt-1 text-xs text-fresh">{sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card delay={200}>
          <H status="Available" right={<span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-mono text-xs text-primary"><span className="pulse-dot size-2 rounded-full bg-fresh" />NOW 10:32</span>}>Today's queue</H>
          <ul className="space-y-2">
            {schedule.map((a, i) => (
              <li key={a.t} className="ws-in" style={{ animationDelay: `${260 + i * 60}ms` }}>
                <button onClick={() => openP(a.p)} className={`group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md ${a.s === "chair" ? "border-primary/40 bg-primary/5" : "border-border"} ${a.s === "done" ? "opacity-60" : ""}`}>
                  <span className="w-12 font-mono text-sm text-muted-foreground">{a.t}</span>
                  <Avatar n={a.p} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.p}</span><span className="block truncate text-xs text-muted-foreground">{a.what} · {a.chair} · {a.mins} min</span></span>
                  <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${stateStyle[a.s][1]}`}>{stateStyle[a.s][0]}</span>
                  <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-1" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card delay={260}>
            <H>Chairs</H>
            <div className="grid grid-cols-3 gap-3">
              {[["Chair 1", "Ready", "Rohan next", "warn"], ["Chair 2", "Cleaning", "turnaround", "muted"], ["Chair 3", "In use", "Kavya · braces", "ok"]].map(([c, s, d, t]) => (
                <div key={c} className="rounded-2xl border border-border p-3 text-center">
                  <span className={`mx-auto block size-3 rounded-full ${t === "ok" ? "pulse-dot bg-fresh" : t === "warn" ? "bg-gold" : "bg-muted-foreground/40"}`} />
                  <p className="mt-2 text-sm font-medium">{c}</p><p className="text-xs">{s}</p><p className="text-[11px] text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card delay={320}>
            <H>Attention</H>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-2"><AlertTriangle className="size-4 shrink-0 text-destructive" />Meera Shah — penicillin allergy on file</li>
              <li className="flex gap-2"><FlaskConical className="size-4 shrink-0 text-gold" />Rohan's PFM crown arrived — fit check today</li>
              <li className="flex gap-2"><Package className="size-4 shrink-0 text-gold" />Composite A2 low · 4 left</li>
              <li className="flex gap-2"><FileText className="size-4 shrink-0 text-primary" />Fatima Khan — consent form not signed</li>
            </ul>
            <button onClick={() => say("Reminders queued on WhatsApp")} className="mt-4 w-full rounded-full bg-secondary py-2 text-sm text-secondary-foreground transition hover:bg-primary hover:text-primary-foreground">Remind pending bills on WhatsApp</button>
          </Card>
        </div>
      </div>

      <Card delay={380}>
        <H>Appointments by hour</H>
        <div className="flex h-44 items-end gap-2 md:gap-4">
          {hours.map(([l, v, done], i) => (
            <div key={l} className="group flex flex-1 flex-col items-center gap-2">
              <span className="font-mono text-[10px] opacity-0 transition group-hover:opacity-100">{v}</span>
              <div className={`ws-bar w-full rounded-t-xl ${done ? "bg-primary" : "bg-secondary group-hover:bg-fresh"}`} style={{ height: `${(v / max) * 120}px`, animationDelay: `${400 + i * 50}ms` }} />
              <span className="font-mono text-[10px] text-muted-foreground">{l}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Patients ---------- */
function PatientsTab({ openP }: { openP: (n: string) => void }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | "bal" | "new">("all");
  const list = patients.filter((p) => (p.n + p.f).toLowerCase().includes(q.toLowerCase()) && (f === "all" || (f === "bal" ? p.bal > 0 : p.visits.length === 0)));
  return (
    <Card>
      <H status="Available" right={<span className="font-mono text-xs text-muted-foreground">1,284 records</span>}>Patients</H>
      <div className="mb-4 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or file no." className="flex-1 rounded-full border border-input bg-surface px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
        {([["all", "All"], ["bal", "With balance"], ["new", "New"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setF(k)} className={`rounded-full px-4 py-2 text-sm transition ${f === k ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-secondary"}`}>{l}</button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p, i) => (
          <button key={p.f} onClick={() => openP(p.n)} className="ws-in group rounded-2xl border border-border p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-center gap-3"><Avatar n={p.n} /><div className="min-w-0 flex-1"><p className="truncate font-medium">{p.n} <span className="text-xs font-normal text-muted-foreground">· {p.age}y</span></p><p className="font-mono text-xs text-muted-foreground">{p.f}</p></div>{p.alert && <AlertTriangle className="size-4 text-destructive" />}</div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Next: {p.next}</span>{p.bal ? <Tag tone="warn">₹{p.bal.toLocaleString("en-IN")} due</Tag> : <Tag tone="ok">Clear</Tag>}</div>
          </button>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground">No patients match.</p>}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">A matching phone number shows a warning — records are never merged automatically.</p>
    </Card>
  );
}

function Drawer({ p, onClose, go }: { p: Patient; onClose: () => void; go: (t: Tab) => void }) {
  const [t, setT] = useState<"timeline" | "teeth" | "bills" | "consent">("timeline");
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 animate-in fade-in bg-forest/40 backdrop-blur-sm" />
      <aside onClick={(e) => e.stopPropagation()} className="ws-drawer absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto bg-background shadow-2xl">
        <div className="bg-forest p-6 text-forest-foreground">
          <div className="flex items-start justify-between"><p className="font-mono text-xs uppercase tracking-widest opacity-70">Patient 360</p><button onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-forest-foreground/10"><X className="size-5" /></button></div>
          <h3 className="font-display mt-2 text-3xl">{p.n}</h3>
          <p className="text-sm opacity-75">{p.f} · {p.age} years</p>
        </div>
        {p.alert && <div className="mx-5 mt-5 flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="size-4 shrink-0" />{p.flags}</div>}
        {!p.alert && <p className="mx-5 mt-5 rounded-2xl bg-muted p-3 text-sm">{p.flags}</p>}
        <div className="mx-5 mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border border-border p-3"><p className="text-xs text-muted-foreground">Last visit</p><p>{p.last}</p></div>
          <div className="rounded-2xl border border-border p-3"><p className="text-xs text-muted-foreground">Next</p><p>{p.next}</p></div>
        </div>
        <div className="mx-5 mt-5 flex gap-1 rounded-full bg-muted p-1">
          {(["timeline", "teeth", "bills", "consent"] as const).map((k) => (
            <button key={k} onClick={() => setT(k)} className={`flex-1 rounded-full py-1.5 text-xs capitalize transition ${t === k ? "bg-surface shadow" : ""}`}>{k}</button>
          ))}
        </div>
        <div key={t} className="ws-in m-5 text-sm">
          {t === "timeline" && (p.visits.length ? <ol className="relative space-y-4 border-l border-border pl-5">{p.visits.map((v) => <li key={v[0] + v[1]} className="relative"><span className="absolute -left-[25px] top-1 size-2.5 rounded-full bg-primary" /><p className="font-medium">{v[1]}</p><p className="text-xs text-muted-foreground">{v[0]}</p></li>)}</ol> : <p className="text-muted-foreground">First visit today.</p>)}
          {t === "teeth" && <div><p className="text-muted-foreground">Open the full chart to record findings per tooth.</p><button onClick={() => go("chart")} className="mt-3 rounded-full bg-primary px-4 py-2 text-primary-foreground">Open tooth chart</button></div>}
          {t === "bills" && (p.visits.length ? <ul className="space-y-2">{p.visits.map((v) => <li key={v[0] + v[1]} className="flex justify-between rounded-xl border border-border p-3"><span>{v[1]}</span><span className="font-mono">{v[2]}</span></li>)}<li className="flex justify-between p-3 font-medium"><span>Balance</span><span className="font-mono">{p.bal ? "₹" + p.bal.toLocaleString("en-IN") : "Nil"}</span></li></ul> : <p className="text-muted-foreground">No bills yet.</p>)}
          {t === "consent" && <div className="flex items-center gap-2">{p.consent ? <><ShieldCheck className="size-5 text-fresh" />Treatment and data consent recorded.</> : <><AlertTriangle className="size-5 text-gold" />Consent pending — ask the patient to sign before treatment.</>}</div>}
        </div>
        <div className="mt-auto flex gap-2 border-t border-border p-5">
          <button onClick={() => go("consult")} className="flex-1 rounded-full bg-primary py-2.5 text-sm text-primary-foreground">Start consultation</button>
          <button onClick={() => go("billing")} className="flex-1 rounded-full border border-input py-2.5 text-sm">Create bill</button>
        </div>
        <p className="px-5 pb-5 text-[11px] text-muted-foreground">This view is recorded in the access log.</p>
      </aside>
    </div>
  );
}

/* ---------- Tooth chart ---------- */
const upper = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const lower = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const kidUpper = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const kidLower = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
const toothFill: Record<ToothState, string> = {
  healthy: "fill-surface stroke-border", caries: "fill-destructive/70 stroke-destructive", rct: "fill-gold stroke-gold",
  crown: "fill-primary stroke-primary", missing: "fill-transparent stroke-muted-foreground/40 [stroke-dasharray:3_3]", implant: "fill-fresh/60 stroke-fresh",
};
const toothDot: Record<ToothState, string> = { healthy: "bg-surface border border-border", caries: "bg-destructive/70", rct: "bg-gold", crown: "bg-primary", missing: "border border-dashed border-muted-foreground", implant: "bg-fresh/60" };

function ChartTab({ say }: { say: (m: string) => void }) {
  const [kid, setKid] = useState(false);
  const [brush, setBrush] = useState<ToothState>("caries");
  const [sel, setSel] = useState<number | null>(36);
  const [map, setMap] = useState<Record<number, ToothState>>({ 36: "crown", 46: "implant", 26: "rct", 14: "caries", 38: "missing", 21: "crown" });
  const plan = Object.entries(map).filter(([, s]) => s !== "healthy");
  const row = (teeth: number[], top: boolean) => (
    <div className="flex justify-center gap-1 md:gap-1.5">
      {teeth.map((n, i) => {
        const s = map[n] ?? "healthy";
        const molar = kid ? [0, 1, 8, 9].includes(i) : [0, 1, 2, 13, 14, 15].includes(i);
        return (
          <button key={n} onClick={() => { setSel(n); setMap((m) => ({ ...m, [n]: m[n] === brush ? "healthy" : brush })); }}
            className={`group flex flex-col items-center gap-1 transition-transform duration-200 hover:-translate-y-1 ${top ? "" : "flex-col-reverse"}`} aria-label={`Tooth ${n}`}>
            <span className={`font-mono text-[10px] ${sel === n ? "text-primary" : "text-muted-foreground"}`}>{n}</span>
            <svg viewBox="0 0 30 40" className={`${molar ? "w-8 md:w-10" : "w-6 md:w-8"} h-10 md:h-12 ${top ? "" : "rotate-180"}`}>
              <path d="M4 6 Q15 0 26 6 L24 22 Q22 38 18 38 Q15 30 12 38 Q8 38 6 22 Z" strokeWidth="1.5"
                className={`transition-all duration-300 ${toothFill[s]} ${sel === n ? "drop-shadow-[0_0_6px_var(--fresh)]" : ""}`} />
            </svg>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <Card>
        <H status="Available" right={<div className="flex rounded-full bg-muted p-1 text-xs">{["Adult", "Child"].map((l, i) => <button key={l} onClick={() => setKid(i === 1)} className={`rounded-full px-3 py-1 transition ${kid === (i === 1) ? "bg-surface shadow" : ""}`}>{l}</button>)}</div>}>Tooth chart · Rohan Iyer</H>
        <div className="mb-5 flex flex-wrap gap-2">
          {toothStates.map((t) => (
            <button key={t.k} onClick={() => setBrush(t.k)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${brush === t.k ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
              <span className={`size-3 rounded-full ${toothDot[t.k]}`} />{t.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-3xl bg-muted/50 py-8">
          <div className="min-w-[560px] space-y-6">
            {row(kid ? kidUpper : upper, true)}
            <div className="mx-auto h-px w-4/5 bg-border" />
            {row(kid ? kidLower : lower, false)}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Pick a finding, then tap a tooth. Tap again to clear. FDI numbering.</p>
      </Card>
      <div className="space-y-6">
        <Card delay={100}>
          <H>Tooth {sel ?? "—"}</H>
          {sel && <div className="space-y-2 text-sm">
            <p>Current: <b>{toothStates.find((t) => t.k === (map[sel] ?? "healthy"))?.label}</b></p>
            <p className="text-muted-foreground">History per tooth, X-rays and lab work stay attached to this tooth.</p>
          </div>}
        </Card>
        <Card delay={160}>
          <H>Treatment plan</H>
          <ul className="space-y-2">
            {plan.map(([n, s], i) => (
              <li key={n} className="ws-in flex items-center justify-between rounded-xl border border-border p-3 text-sm" style={{ animationDelay: `${i * 40}ms` }}>
                <span className="flex items-center gap-2"><span className={`size-3 rounded-full ${toothDot[s]}`} />Tooth {n}</span>
                <span className="text-muted-foreground">{toothStates.find((t) => t.k === s)?.label}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => say("Plan shared with patient for approval")} className="mt-4 w-full rounded-full bg-primary py-2.5 text-sm text-primary-foreground transition hover:-translate-y-0.5">Share plan with patient</button>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Consult & Rx ---------- */
const meds = [
  { n: "Amoxicillin 500 mg", d: "1-0-1 · 5 days · after food", allergy: true },
  { n: "Ibuprofen 400 mg", d: "1-1-1 · 3 days · after food", allergy: false },
  { n: "Chlorhexidine 0.2% rinse", d: "Twice daily · 7 days", allergy: false },
];
const lines = ["Chief complaint: sensitivity on lower left molar.", "Findings: crown margin good, mild gingival inflammation near 36.", "Done: PFM crown cemented on 36. Occlusion checked.", "Advice: soft food for 24 hours, review in 2 weeks."];

function ConsultTab({ say }: { say: (m: string) => void }) {
  const [rec, setRec] = useState(false);
  const [shown, setShown] = useState(0);
  const [rx, setRx] = useState<typeof meds>([]);
  const [lang, setLang] = useState("English");
  useEffect(() => {
    if (!rec) return;
    if (shown >= lines.length) { setRec(false); return; }
    const t = setTimeout(() => setShown((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [rec, shown]);
  const add = (m: (typeof meds)[number]) => {
    if (rx.find((x) => x.n === m.n)) return;
    if (m.allergy) say("Allergy check: no penicillin allergy recorded for Rohan");
    setRx((r) => [...r, m]);
  };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <H status="In development">Voice to note</H>
        <div className="flex flex-col items-center rounded-3xl bg-muted/50 p-8">
          <button onClick={() => { if (!rec && shown >= lines.length) setShown(0); setRec(!rec); }}
            className={`grid size-20 place-items-center rounded-full transition-all duration-300 ${rec ? "pulse-dot scale-110 bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground hover:scale-105"}`} aria-label={rec ? "Stop" : "Record"}>
            {rec ? <Square className="size-7" /> : <Mic className="size-8" />}
          </button>
          <div className="ws-wave mt-6 flex h-10 items-center gap-1">
            {Array.from({ length: 28 }).map((_, i) => <span key={i} style={{ height: "100%", animationDelay: `${(i % 7) * 0.12}s`, animationPlayState: rec ? "running" : "paused", opacity: rec ? 1 : 0.3 }} />)}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{rec ? "Listening… speak in English, Hindi or Marathi" : "Tap to dictate while you work"}</p>
        </div>
        <div className="mt-5 space-y-2">
          {lines.slice(0, shown).map((l) => <p key={l} className="ws-in rounded-xl border border-border p-3 text-sm">{l}</p>)}
        </div>
        {shown > 0 && <p className="mt-3 text-xs text-muted-foreground">A draft for you to check and edit. Nothing is saved until you approve it.</p>}
      </Card>
      <Card delay={100}>
        <H status="Available" right={<select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-full border border-input bg-surface px-3 py-1 text-xs"><option>English</option><option>हिन्दी</option><option>मराठी</option></select>}>Prescription</H>
        <p className="mb-2 text-xs text-muted-foreground">Favourites for "PFM crown cementation"</p>
        <div className="flex flex-wrap gap-2">
          {meds.map((m) => <button key={m.n} onClick={() => add(m)} className="rounded-full border border-border px-3 py-1.5 text-xs transition hover:border-primary hover:bg-primary/5"><Plus className="mr-1 inline size-3" />{m.n}</button>)}
        </div>
        <div className="mt-5 min-h-40 space-y-2 rounded-2xl border border-dashed border-border p-4">
          {rx.length === 0 && <p className="text-sm text-muted-foreground">Tap a favourite or repeat the last prescription.</p>}
          {rx.map((m) => (
            <div key={m.n} className="ws-in flex items-start justify-between rounded-xl bg-muted/60 p-3">
              <div><p className="text-sm font-medium">{m.n}</p><p className="text-xs text-muted-foreground">{m.d}{lang !== "English" ? ` · instructions in ${lang}` : ""}</p></div>
              <button onClick={() => setRx((r) => r.filter((x) => x.n !== m.n))} aria-label="Remove"><X className="size-4 text-muted-foreground" /></button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setRx(meds.slice(1))} className="flex-1 rounded-full border border-input py-2.5 text-sm">Repeat last Rx</button>
          <button disabled={!rx.length} onClick={() => say("Rx printed with QR · secure link sent on WhatsApp")} className="flex-1 rounded-full bg-primary py-2.5 text-sm text-primary-foreground transition disabled:opacity-40">Print & send</button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><QrCode className="size-3.5" />Printed copy carries a QR to the verified digital version.</p>
      </Card>
    </div>
  );
}

/* ---------- Calendar ---------- */
const days = ["Mon 29", "Tue 30", "Wed 1", "Thu 2", "Fri 3", "Sat 4", "Sun 5"];
const evs: Record<number, [string, string, string][]> = {
  0: [["9:00", "Cleaning", "ok"], ["14:00", "Filling", "c"]], 1: [["10:30", "RCT", "c"], ["16:00", "Review", "ok"]],
  2: [["9:00", "Crown", "c"], ["11:00", "Consult", "m"]], 3: [["10:00", "Braces", "w"], ["15:30", "Polish", "ok"]],
  4: [["9:00", "Implant", "c"], ["12:00", "Filling", "ok"]], 5: [["9:00", "Review", "ok"], ["10:15", "Braces", "w"], ["10:45", "Crown", "c"], ["12:15", "Implant", "c"]],
  6: [["10:00", "Emergency slot", "w"]],
};
const evTone: Record<string, string> = { ok: "bg-secondary text-secondary-foreground", c: "bg-primary text-primary-foreground", w: "bg-gold-soft text-forest", m: "bg-muted" };
function CalendarTab({ say }: { say: (m: string) => void }) {
  return (
    <Card>
      <H status="Available" right={<button onClick={() => say("Walk-in registered")} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">+ Walk-in</button>}>This week</H>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d, i) => (
          <div key={d} className={`ws-in rounded-2xl border p-3 ${i === 5 ? "border-primary bg-primary/5" : "border-border"}`} style={{ animationDelay: `${i * 50}ms` }}>
            <p className={`text-sm font-medium ${i === 5 ? "text-primary" : ""}`}>{d}</p>
            <div className="mt-3 space-y-1.5">
              {(evs[i] ?? []).map(([t, l, c]) => (
                <button key={t + l} onClick={() => say(`${l} · ${t}`)} className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs transition hover:scale-[1.03] ${evTone[c]}`}><Clock className="mr-1 inline size-3" />{t} {l}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Online booking from your clinic website is coming next.</p>
    </Card>
  );
}

/* ---------- Billing ---------- */
function BillingTab({ say }: { say: (m: string) => void }) {
  const [qr, setQr] = useState(false);
  const max = Math.max(...weekly);
  return (
    <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <Card>
        <H status="Available" right={<button onClick={() => say("Excel export ready for your accountant")} className="flex items-center gap-1.5 rounded-full border border-input px-3 py-1.5 text-xs"><Download className="size-3.5" />Excel</button>}>Invoices</H>
        <ul className="divide-y divide-border">
          {invoices.map(([no, n, amt, mode, s], i) => (
            <li key={no} className="ws-in flex items-center gap-3 py-3 text-sm" style={{ animationDelay: `${i * 50}ms` }}>
              <Avatar n={n} /><div className="min-w-0 flex-1"><p className="font-medium">{n}</p><p className="font-mono text-[11px] text-muted-foreground">{no} · {mode}</p></div>
              <span className="font-mono">{amt}</span><Tag tone={s === "PAID" ? "ok" : s === "DUE" ? "warn" : "muted"}>{s}</Tag>
            </li>
          ))}
        </ul>
        <div className="mt-6"><p className="mb-3 text-sm font-medium">Weekly collections</p>
          <div className="flex h-32 items-end gap-2">{weekly.map((v, i) => <div key={i} className="ws-bar flex-1 rounded-t-lg bg-primary/80 hover:bg-primary" style={{ height: `${(v / max) * 100}%`, animationDelay: `${i * 60}ms` }} title={`W${i + 1}`} />)}</div>
        </div>
      </Card>
      <Card delay={100}>
        <H>Kavya Reddy · bill</H>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between"><span>Braces adjustment</span><span className="font-mono">₹3,500</span></li>
          <li className="flex justify-between"><span>Elastics pack</span><span className="font-mono">₹700</span></li>
          <li className="flex justify-between border-t border-border pt-2 font-medium"><span>Total</span><span className="font-mono">₹4,200</span></li>
        </ul>
        <div className="mt-5 grid place-items-center rounded-3xl bg-muted/50 p-6">
          {qr ? (
            <div className="ws-in text-center">
              <div className="mx-auto grid size-36 grid-cols-8 gap-0.5 rounded-xl bg-surface p-2">{Array.from({ length: 64 }).map((_, i) => <span key={i} className={(i * 37 + (i >> 3) * 11) % 3 ? "bg-forest" : ""} />)}</div>
              <p className="mt-3 text-sm">Scan with any UPI app</p>
            </div>
          ) : <QrCode className="ws-float size-16 text-primary" />}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setQr(true)} className="flex-1 rounded-full bg-primary py-2.5 text-sm text-primary-foreground">Show UPI QR</button>
          <button onClick={() => { setQr(false); say("Payment recorded · receipt sent"); }} className="flex-1 rounded-full border border-input py-2.5 text-sm">Mark paid</button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Payments go straight to the clinic. Aarogyam never holds clinic money. Online collection is coming next.</p>
      </Card>
    </div>
  );
}

/* ---------- Stock & Lab ---------- */
const stages = ["Impression", "Sent to lab", "In progress", "Arrived"];
function StockTab({ say }: { say: (m: string) => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <H status="Available">Materials</H>
        <ul className="space-y-4">
          {stock.map(([n, c, have, at], i) => {
            const pct = Math.min(100, Math.round((have / at) * 100));
            const tone = pct < 25 ? "bg-destructive" : pct < 50 ? "bg-gold" : "bg-fresh";
            return (
              <li key={n} className="text-sm">
                <div className="flex justify-between"><span>{n} <span className="text-xs text-muted-foreground">· {c}</span></span><span className="font-mono text-xs">{have} / {at}</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className={`ws-fill h-full rounded-full ${tone}`} style={{ width: `${pct}%`, animationDelay: `${i * 80}ms` }} /></div>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex items-center justify-between"><StatusBadge status="Coming next" /><span className="text-xs text-muted-foreground">Low-stock alerts in the owner's attention list</span></div>
      </Card>
      <Card delay={100}>
        <H status="Available">Lab work</H>
        <ul className="space-y-4">
          {labCases.map((l, i) => (
            <li key={l.item} className="ws-in rounded-2xl border border-border p-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex justify-between text-sm"><span className="font-medium">{l.p}</span><span className={l.stage === 3 ? "text-fresh" : "text-muted-foreground"}>{l.due}</span></div>
              <p className="text-xs text-muted-foreground">{l.item} · {l.lab}</p>
              <div className="mt-3 flex gap-1">{stages.map((s, k) => <div key={s} className="flex-1"><div className={`h-1.5 rounded-full transition-all duration-700 ${k <= l.stage ? "bg-primary" : "bg-muted"}`} /><p className="mt-1 hidden text-[10px] text-muted-foreground sm:block">{s}</p></div>)}</div>
            </li>
          ))}
        </ul>
        <button onClick={() => say("New lab order created for tooth 21")} className="mt-4 w-full rounded-full border border-input py-2.5 text-sm">+ New lab order</button>
      </Card>
    </div>
  );
}

/* ---------- Messages ---------- */
function MessagesTab({ say }: { say: (m: string) => void }) {
  const [i, setI] = useState(0);
  const msg = useMemo(() => (templates[i]?.[2] ?? "").replace("{name}", "Meera").replace("{time}", "10:30 AM"), [i]);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Card>
        <H status="Available">Templates</H>
        <ul className="space-y-2">
          {templates.map(([t, d], k) => (
            <li key={t}><button onClick={() => setI(k)} className={`w-full rounded-2xl border p-4 text-left transition ${i === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}>
              <p className="text-sm font-medium">{t}</p><p className="text-xs text-muted-foreground">{d}</p>
            </button></li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="flex items-center gap-1.5">Follow-up & recall <StatusBadge status="Coming next" /></span><span className="flex items-center gap-1.5">Two-way WhatsApp <StatusBadge status="In development" /></span></div>
      </Card>
      <Card delay={100}>
        <H>Preview</H>
        <div className="mx-auto max-w-xs rounded-[2rem] border-8 border-forest bg-muted p-4">
          <p className="text-center text-[11px] text-muted-foreground">Smile Catchers Dental</p>
          <div key={i} className="ws-in mt-4 rounded-2xl rounded-tl-sm bg-surface p-3 text-sm shadow">{msg}<p className="mt-1 text-right text-[10px] text-muted-foreground">10:02 <Check className="inline size-3 text-fresh" /></p></div>
        </div>
        <button onClick={() => say("Test message sent")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm text-primary-foreground"><Send className="size-4" />Send test</button>
        <p className="mt-3 text-xs text-muted-foreground">Promotional messages only go to patients who opted in.</p>
      </Card>
    </div>
  );
}
