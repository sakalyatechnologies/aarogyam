// Everything here is free of clinic types. // moves to sakalya-web (V4 page header, hero, ring, stat tile, chip, list row, banner, empty state, skeleton)
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

/** Two initials from a name, skipping a title such as Dr. */
export function initials(name: string): string {
  const words = name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter((word) => word !== "");
  return (words.length > 1 ? `${words[0]?.charAt(0) ?? ""}${words[words.length - 1]?.charAt(0) ?? ""}` : (words[0] ?? "").slice(0, 2)).toUpperCase();
}

/** V4 page header: small uppercase eyebrow, large title, one-line subtitle, actions on the right. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mk-ph">
      <div className="mk-ph-t">
        {eyebrow === undefined ? null : <div className="mk-ph-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle === undefined ? null : <p>{subtitle}</p>}
      </div>
      {actions === undefined ? null : <div className="mk-ph-a">{actions}</div>}
    </header>
  );
}

/** Progress ring: `value` of `total` done, drawn as an arc with the count in the middle. */
export function ProgressRing({ value, total, caption, label }: { value: number; total: number; caption: string; label: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const pct = total <= 0 ? 0 : Math.min(1, value / total);
  return (
    <div className="mk-ring" role="img" aria-label={label}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r={r} className="mk-ring-track" />
        <circle cx="40" cy="40" r={r} className="mk-ring-arc" strokeDasharray={`${String(c * pct)} ${String(c)}`} transform="rotate(-90 40 40)" />
      </svg>
      <div className="mk-ring-c" aria-hidden="true">
        <strong>
          {value}
          <span>/{total}</span>
        </strong>
        <small>{caption}</small>
      </div>
    </div>
  );
}

/** V4 hero card: deep brand gradient, eyebrow, the person or thing up next, an optional ring and one main action. */
export function HeroCard({ eyebrow, title, detail, meta, ring, action, label }: { eyebrow: ReactNode; title: ReactNode; detail?: ReactNode; meta?: ReactNode; ring?: ReactNode; action?: ReactNode; label: string }) {
  return (
    <section className="mk-hero4" aria-label={label}>
      <div className="mk-hero4-eyebrow">{eyebrow}</div>
      <div className="mk-hero4-ctx">
        <div style={{ minWidth: 0 }}>
          <h2>{title}</h2>
          {detail === undefined ? null : <p>{detail}</p>}
        </div>
        {ring}
      </div>
      {meta === undefined ? null : <p className="mk-hero4-meta">{meta}</p>}
      {action === undefined ? null : <div className="mk-hero4-a">{action}</div>}
    </section>
  );
}

export type Trend = { direction: "up" | "down" | "flat"; text: string; good?: boolean };

/** V4 stat tile: big number, label, an optional trend with an arrow (green when good, red when not). */
export function StatTile({ label, value, trend, icon, tone }: { label: string; value: ReactNode; trend?: Trend | undefined; icon?: ReactNode; tone?: "warn" | "brand" | undefined }) {
  const good = trend?.good ?? trend?.direction === "up";
  return (
    <div className={`mk-stat ${tone ?? ""}`}>
      <div className="mk-stat-h">
        <span className="mk-stat-l">{label}</span>
        {icon === undefined ? null : (
          <span className="mk-stat-i" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <strong className="mk-stat-v">{value}</strong>
      {trend === undefined ? null : (
        <span className={`mk-trend ${trend.direction === "flat" ? "flat" : good ? "good" : "bad"}`}>
          {trend.direction === "up" ? <ArrowUpRight aria-hidden="true" /> : trend.direction === "down" ? <ArrowDownRight aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
          {trend.text}
        </span>
      )}
    </div>
  );
}

export type ChipTone = "ready" | "waiting" | "confirmed" | "done" | "noshow" | "brand";

/** Colour-coded status chip: Ready green, Waiting amber, Confirmed blue, Done grey, No-show red. */
export function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`mk-chip ${tone}`}>{children}</span>;
}

/** Soft initials avatar, V4 style. */
export function Initials({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span aria-hidden="true" className={`mk-ini ${size}`}>
      {initials(name)}
    </span>
  );
}

/** V4 section header: a title and an optional "View all" style link. */
export function SectionHeader({ title, action, id }: { title: string; action?: { label: string; to: string } | ReactNode; id?: string }) {
  return (
    <div className="mk-sech">
      <h2 id={id}>{title}</h2>
      {action !== null && typeof action === "object" && "to" in action && "label" in action ? (
        <Link to={action.to} className="mk-link">
          {action.label}
        </Link>
      ) : (
        action
      )}
    </div>
  );
}

/** A panel of list rows. */
export function ListPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="mk-list" aria-label={label}>
      {children}
    </ul>
  );
}

/** One row: time or avatar first, title and subtitle, a chip or chevron at the end. A link when `to` is set. */
export function ListRow({ to, onClick, lead, name, title, subtitle, trailing, extra }: { to?: string; onClick?: () => void; lead?: ReactNode; name?: string; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; extra?: ReactNode }) {
  const body = (
    <>
      {lead === undefined ? null : <span className="mk-lrow-lead">{lead}</span>}
      {name === undefined ? null : <Initials name={name} />}
      <span className="mk-lrow-info">
        <strong>{title}</strong>
        {subtitle === undefined ? null : <span>{subtitle}</span>}
      </span>
      {extra === undefined ? null : <span className="mk-lrow-extra">{extra}</span>}
      <span className="mk-lrow-end">{trailing ?? (to === undefined && onClick === undefined ? null : <ChevronRight aria-hidden="true" className="mk-chev" />)}</span>
    </>
  );
  return (
    <li>
      {to !== undefined ? (
        <Link to={to} className="mk-lrow">
          {body}
        </Link>
      ) : onClick !== undefined ? (
        <button type="button" className="mk-lrow" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="mk-lrow">{body}</div>
      )}
    </li>
  );
}

/** Allergy or alert banner. */
export function AlertBanner({ tone = "warn", children, action }: { tone?: "warn" | "danger" | "info"; children: ReactNode; action?: ReactNode }) {
  const icon = tone === "danger" ? <ShieldAlert aria-hidden="true" /> : tone === "info" ? <Info aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />;
  return (
    <div className={`mk-alert ${tone}`}>
      {icon}
      <div className="mk-alert-t">{children}</div>
      {action}
    </div>
  );
}

export type Art = "calendar" | "patients" | "search" | "bill" | "stock" | "queue" | "files" | "rx" | "notes" | "chart" | "clear" | "team" | "lab" | "plan";

/** Simple two-tone line drawings for empty states. Decorative: the title says what is empty. */
export function Illustration({ art }: { art: Art }) {
  return (
    <svg className="mk-ill" viewBox="0 0 120 96" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="60" cy="86" rx="38" ry="5" className="mk-ill-shadow" />
      <circle cx="60" cy="46" r="38" className="mk-ill-blob" />
      <circle cx="98" cy="18" r="4" className="mk-ill-dot" />
      <circle cx="20" cy="70" r="3" className="mk-ill-dot" />
      {ART[art]}
    </svg>
  );
}

const ART: Record<Art, ReactNode> = {
  calendar: (
    <g className="mk-ill-line">
      <rect x="34" y="26" width="52" height="46" rx="8" className="mk-ill-card" />
      <path d="M34 40h52M46 20v12M74 20v12" />
      <path d="M46 52h6M58 52h6M70 52h6M46 62h6M58 62h6" />
      <path d="M68 60l4 4 8-8" className="mk-ill-accent" />
    </g>
  ),
  patients: (
    <g className="mk-ill-line">
      <rect x="30" y="24" width="60" height="48" rx="10" className="mk-ill-card" />
      <circle cx="50" cy="44" r="7" />
      <path d="M39 62c2-6 6-9 11-9s9 3 11 9" />
      <path d="M68 42h12M68 50h8" className="mk-ill-accent" />
    </g>
  ),
  search: (
    <g className="mk-ill-line">
      <rect x="28" y="26" width="48" height="40" rx="8" className="mk-ill-card" />
      <path d="M38 38h22M38 46h14" />
      <circle cx="74" cy="56" r="11" className="mk-ill-card" />
      <path d="M82 64l8 8" className="mk-ill-accent" />
    </g>
  ),
  bill: (
    <g className="mk-ill-line">
      <path d="M40 20h40v54l-6-4-7 4-7-4-7 4-7-4-6 4z" className="mk-ill-card" />
      <path d="M48 34h24M48 42h24M48 50h14" />
      <path d="M62 58h10" className="mk-ill-accent" />
    </g>
  ),
  stock: (
    <g className="mk-ill-line">
      <path d="M60 22l26 12v28L60 74 34 62V34z" className="mk-ill-card" />
      <path d="M34 34l26 12 26-12M60 46v28" />
      <path d="M47 28l26 12" className="mk-ill-accent" />
    </g>
  ),
  queue: (
    <g className="mk-ill-line">
      <rect x="30" y="26" width="60" height="12" rx="6" className="mk-ill-card" />
      <rect x="30" y="44" width="60" height="12" rx="6" className="mk-ill-card" />
      <rect x="30" y="62" width="40" height="12" rx="6" className="mk-ill-card" />
      <circle cx="38" cy="32" r="2" className="mk-ill-accent" />
      <circle cx="38" cy="50" r="2" className="mk-ill-accent" />
    </g>
  ),
  files: (
    <g className="mk-ill-line">
      <path d="M30 32a6 6 0 016-6h14l6 6h28a6 6 0 016 6v28a6 6 0 01-6 6H36a6 6 0 01-6-6z" className="mk-ill-card" />
      <path d="M48 58l8-10 6 7 4-4 8 7" className="mk-ill-accent" />
    </g>
  ),
  rx: (
    <g className="mk-ill-line">
      <rect x="36" y="20" width="48" height="56" rx="8" className="mk-ill-card" />
      <path d="M46 32v14M46 32h7a4 4 0 010 8h-7M51 40l9 10M60 40l-9 10" className="mk-ill-accent" />
      <path d="M46 60h28M46 67h18" />
    </g>
  ),
  notes: (
    <g className="mk-ill-line">
      <rect x="34" y="22" width="44" height="54" rx="8" className="mk-ill-card" />
      <path d="M44 36h24M44 44h24M44 52h14" />
      <path d="M70 68l14-14 5 5-14 14h-5z" className="mk-ill-accent" />
    </g>
  ),
  chart: (
    <g className="mk-ill-line">
      <rect x="28" y="24" width="64" height="48" rx="8" className="mk-ill-card" />
      <path d="M38 62V50M50 62V42M62 62V46M74 62V36" />
      <path d="M38 44l12-8 12 4 14-10" className="mk-ill-accent" />
    </g>
  ),
  clear: (
    <g className="mk-ill-line">
      <circle cx="60" cy="46" r="20" className="mk-ill-card" />
      <path d="M50 46l7 7 13-14" className="mk-ill-accent" />
    </g>
  ),
  team: (
    <g className="mk-ill-line">
      <circle cx="48" cy="40" r="8" className="mk-ill-card" />
      <circle cx="74" cy="44" r="7" className="mk-ill-card" />
      <path d="M32 70c2-9 8-14 16-14s14 5 16 14M62 70c2-7 6-11 12-11s10 4 12 11" />
      <path d="M86 26v8M82 30h8" className="mk-ill-accent" />
    </g>
  ),
  lab: (
    <g className="mk-ill-line">
      <path d="M52 22h16M55 22v18L40 66a5 5 0 004 8h32a5 5 0 004-8L65 40V22" className="mk-ill-card" />
      <path d="M46 58h28" className="mk-ill-accent" />
    </g>
  ),
  plan: (
    <g className="mk-ill-line">
      <rect x="32" y="22" width="56" height="54" rx="8" className="mk-ill-card" />
      <path d="M42 36l3 3 6-6M42 50l3 3 6-6" className="mk-ill-accent" />
      <path d="M56 36h22M56 50h22M42 64h36" />
    </g>
  ),
};

/** Empty state with a drawing and a helpful next action, never a bare box. `compact` sits inside cards. */
export function EmptyState({ art = "clear", title, description, action, compact = false }: { art?: Art; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean; icon?: ReactNode; className?: string }) {
  return (
    <div className={`mk-empty4 ${compact ? "compact" : ""}`}>
      <Illustration art={art} />
      <p className="mk-empty4-t">{title}</p>
      {description === undefined || description === "" ? null : <p className="mk-empty4-d">{description}</p>}
      {action === undefined ? null : <div className="mk-empty4-a">{action}</div>}
    </div>
  );
}

/** A shimmering placeholder in the V4 shapes. Hidden from screen readers; announce loading on the region. */
export function Skeleton({ shape = "line", className = "", style }: { shape?: "line" | "circle" | "block" | "hero" | "stat" | "row"; className?: string; style?: CSSProperties | undefined }) {
  return <span aria-hidden="true" className={`mk-skel ${shape} ${className}`} style={style} />;
}

/** A list of skeleton rows (avatar, two lines, chip) in a panel, with one status for screen readers. */
export function SkeletonList({ count = 4, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="mk-list mk-skel-list">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="mk-lrow" aria-hidden="true">
          <Skeleton shape="circle" />
          <span className="mk-lrow-info">
            <Skeleton shape="line" style={{ width: `${String(46 - (index % 3) * 8)}%` }} />
            <Skeleton shape="line" style={{ width: `${String(28 + (index % 2) * 10)}%`, height: 10 }} />
          </span>
          <Skeleton shape="line" style={{ width: 64, height: 22, borderRadius: 9 }} />
        </div>
      ))}
    </div>
  );
}

/** V4 segmented filter: one pressed button at a time. */
export function Segments<V extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: V; label: string }[]; value: V; onChange: (next: V) => void }) {
  return (
    <div className="mk-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A vertical history timeline. */
export function Timeline({ label, items }: { label: string; items: readonly { id: string; title: ReactNode; detail?: ReactNode; when: ReactNode }[] }) {
  return (
    <ol className="mk-tline" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <strong>{item.when}</strong>
          <span>{item.title}</span>
          {item.detail === undefined ? null : <small>{item.detail}</small>}
        </li>
      ))}
    </ol>
  );
}
