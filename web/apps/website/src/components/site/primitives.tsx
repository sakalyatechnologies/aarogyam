import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Status = "Available" | "Coming next" | "In development" | "Roadmap" | "Coming later";

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const tone =
    status === "Available"
      ? "bg-secondary text-primary"
      : status === "Coming next"
        ? "bg-gold-soft text-foreground"
        : status === "In development"
          ? "bg-muted text-foreground"
          : "border border-border text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider", tone, className)}>
      {status === "Available" && <span className="h-1.5 w-1.5 rounded-full bg-fresh" />}
      {status}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-xs uppercase tracking-[0.18em] text-primary", className)}>{children}</p>
  );
}

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("reveal", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function Section({ children, className, id, tone = "default" }: { children: ReactNode; className?: string; id?: string; tone?: "default" | "surface" | "forest" | "sage" }) {
  const t = {
    default: "",
    surface: "bg-surface",
    forest: "bg-forest text-forest-foreground",
    sage: "bg-sage/60",
  }[tone];
  return (
    <section id={id} className={cn("px-5 py-20 md:py-28", t, className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHead({ eyebrow, title, lede, center, dark }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; center?: boolean; dark?: boolean }) {
  return (
    <Reveal className={cn("max-w-3xl", center && "mx-auto text-center")}>
      {eyebrow && <Eyebrow className={cn(dark && "text-gold")}>{eyebrow}</Eyebrow>}
      <h2 className="font-display mt-3 text-4xl leading-[1.08] md:text-5xl">{title}</h2>
      {lede && <p className={cn("mt-5 text-lg leading-relaxed", dark ? "text-forest-foreground/75" : "text-muted-foreground")}>{lede}</p>}
    </Reveal>
  );
}

export function PrimaryButton({ to = "/book-demo", children, className }: { to?: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-12px_var(--primary)] transition hover:-translate-y-0.5 hover:bg-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

export function GhostButton({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn("inline-flex items-center gap-2 rounded-full border border-input bg-surface px-6 py-3 text-sm font-medium text-foreground transition hover:border-primary hover:text-primary", className)}
    >
      {children}
    </Link>
  );
}

export function FeatureCard({ icon, title, body, status }: { icon?: ReactNode; title: string; body: string; status?: Status }) {
  return (
    <div className="group h-full rounded-2xl border border-border bg-surface p-6 transition hover:-translate-y-1 hover:shadow-[0_18px_40px_-24px_var(--forest)]">
      <div className="flex items-start justify-between gap-3">
        {icon && <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary">{icon}</div>}
        {status && <StatusBadge status={status} />}
      </div>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function PageHero({ eyebrow, title, lede, children }: { eyebrow: string; title: ReactNode; lede: ReactNode; children?: ReactNode }) {
  return (
    <section className="grain-bg px-5 pb-16 pt-32 md:pb-24 md:pt-40">
      <div className="mx-auto max-w-6xl">
        <div className="animate-rise max-w-3xl">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-display mt-4 text-5xl leading-[1.04] md:text-6xl">{title}</h1>
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground md:text-xl">{lede}</p>
          {children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}

export function CTABand({ title = "See how Aarogyam would work for your clinic.", body = "A short walkthrough, shaped around your specialty and the way your clinic runs today." }: { title?: string; body?: string }) {
  return (
    <section className="px-5 pb-24">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-forest px-8 py-16 text-forest-foreground md:px-16">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-fresh/25 blur-3xl" />
        <p className="font-deva text-gold text-lg">आरोग्यं धनसम्पदा</p>
        <h2 className="font-display mt-3 max-w-2xl text-4xl leading-tight md:text-5xl">{title}</h2>
        <p className="mt-4 max-w-xl text-forest-foreground/75">{body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/register" className="inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-semibold text-forest transition hover:-translate-y-0.5">
            Book a Demo <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/" className="inline-flex items-center gap-2 rounded-full border border-forest-foreground/25 px-6 py-3 text-sm font-medium transition hover:bg-forest-foreground/10">
            Join the pilot
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-secondary text-primary">
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5"><path d="M2.5 6.2l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span>{children}</span>
    </li>
  );
}

export function seo(title: string, description: string, path: string) {
  const full = `${title} · Aarogyam`;
  return {
    meta: [
      { title: full },
      { name: "description", content: description },
      { property: "og:title", content: full },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: path },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: path }],
  };
}
