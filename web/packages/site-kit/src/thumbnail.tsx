import { paletteOf, type TemplateId } from "./catalog.js";

/**
 * A small drawing of a design in a palette, for the template gallery. Drawn in SVG from the same
 * palette values as the site, so it always matches what the clinic gets.
 */
export function TemplateThumbnail({ template, palette, label }: { template: TemplateId; palette: string; label?: string }) {
  const p = paletteOf(template, palette);
  const title = label ?? `${template} design in ${p.name}`;
  return (
    <svg viewBox="0 0 240 160" role="img" aria-label={title} className="cs-thumb" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="160" fill={p.bg} />
      {template === "aurora" && (
        <>
          <circle cx="170" cy="60" r="70" fill={p.accent} opacity="0.16" />
          <rect x="14" y="12" width="40" height="7" rx="3.5" fill={p.text} opacity="0.85" />
          <rect x="120" y="12" width="14" height="5" rx="2.5" fill={p.muted} />
          <rect x="142" y="12" width="14" height="5" rx="2.5" fill={p.muted} />
          <rect x="164" y="12" width="14" height="5" rx="2.5" fill={p.muted} />
          <rect x="196" y="9" width="30" height="12" rx="6" fill={p.accent} />
          <rect x="14" y="44" width="92" height="10" rx="5" fill={p.text} />
          <rect x="14" y="60" width="70" height="10" rx="5" fill={p.text} />
          <rect x="14" y="80" width="84" height="5" rx="2.5" fill={p.muted} />
          <rect x="14" y="92" width="58" height="5" rx="2.5" fill={p.muted} />
          <rect x="14" y="108" width="40" height="13" rx="6.5" fill={p.accent} />
          <path d="M138 140V70a32 32 0 0 1 64 0v70z" fill={p.surface2} stroke={p.accent} strokeWidth="1.5" />
          <rect x="14" y="136" width="212" height="16" rx="8" fill={p.surface} />
        </>
      )}
      {template === "hearth" && (
        <>
          <circle cx="40" cy="30" r="46" fill={p.surface2} />
          <circle cx="210" cy="130" r="50" fill={p.surface2} />
          <rect x="12" y="10" width="216" height="16" rx="8" fill={p.surface} />
          <rect x="22" y="15" width="34" height="6" rx="3" fill={p.accentText} />
          <rect x="186" y="13" width="34" height="10" rx="5" fill={p.accent} />
          <rect x="18" y="44" width="96" height="10" rx="5" fill={p.text} />
          <rect x="18" y="60" width="74" height="10" rx="5" fill={p.text} />
          <rect x="18" y="80" width="30" height="10" rx="5" fill={p.surface} stroke={p.line} />
          <rect x="52" y="80" width="30" height="10" rx="5" fill={p.surface} stroke={p.line} />
          <rect x="18" y="104" width="44" height="14" rx="7" fill={p.accent} />
          <path d="M128 112c-8-30 8-62 40-62s52 22 44 52-30 36-52 30-26-6-32-20z" fill={p.surface2} stroke={p.accent} strokeWidth="1.5" />
          <rect x="18" y="134" width="64" height="18" rx="9" fill={p.surface} stroke={p.line} />
          <rect x="88" y="134" width="64" height="18" rx="9" fill={p.surface} stroke={p.line} />
          <rect x="158" y="134" width="64" height="18" rx="9" fill={p.surface} stroke={p.line} />
        </>
      )}
      {template === "clinical" && (
        <>
          <rect width="240" height="9" fill={p.surface2} />
          <rect x="14" y="20" width="36" height="6" rx="3" fill={p.text} />
          <rect x="112" y="21" width="16" height="4" rx="2" fill={p.muted} />
          <rect x="136" y="21" width="16" height="4" rx="2" fill={p.muted} />
          <rect x="160" y="21" width="16" height="4" rx="2" fill={p.muted} />
          <rect x="190" y="17" width="36" height="12" rx="3" fill={p.accent} />
          <line x1="0" y1="36" x2="240" y2="36" stroke={p.line} />
          <rect x="14" y="52" width="26" height="4" rx="2" fill={p.accentText} />
          <rect x="14" y="64" width="100" height="9" rx="3" fill={p.text} />
          <rect x="14" y="78" width="80" height="9" rx="3" fill={p.text} />
          <rect x="14" y="96" width="92" height="4" rx="2" fill={p.muted} />
          <rect x="14" y="108" width="40" height="12" rx="3" fill={p.accent} />
          <rect x="132" y="50" width="94" height="76" rx="6" fill={p.surface} stroke={p.line} />
          <rect x="142" y="60" width="50" height="6" rx="3" fill={p.text} />
          <rect x="142" y="76" width="70" height="4" rx="2" fill={p.muted} />
          <rect x="142" y="86" width="60" height="4" rx="2" fill={p.muted} />
          <rect x="142" y="96" width="66" height="4" rx="2" fill={p.muted} />
          <rect x="142" y="108" width="74" height="10" rx="3" fill={p.accent} />
          <line x1="14" y1="140" x2="226" y2="140" stroke={p.line} />
          <rect x="14" y="146" width="40" height="6" rx="3" fill={p.muted} />
        </>
      )}
      {template === "bold" && (
        <>
          <rect x="0" y="0" width="240" height="108" fill={p.accent} />
          <rect x="0" y="0" width="240" height="22" fill={p.bg} stroke={p.line} strokeWidth="2" />
          <rect x="12" y="7" width="40" height="8" rx="2" fill={p.text} />
          <rect x="190" y="5" width="38" height="12" rx="6" fill={p.accent} stroke={p.line} strokeWidth="2" />
          <rect x="14" y="34" width="118" height="16" rx="2" fill={p.onAccent} />
          <rect x="14" y="54" width="94" height="16" rx="2" fill={p.onAccent} />
          <rect x="14" y="78" width="54" height="16" rx="8" fill={p.bg} stroke={p.line} strokeWidth="2" />
          <rect x="156" y="36" width="68" height="62" rx="6" fill={p.surface} stroke={p.line} strokeWidth="2" transform="rotate(4 190 67)" />
          <rect x="0" y="108" width="240" height="14" fill={p.line} />
          <rect x="10" y="112" width="40" height="6" fill={p.bg} />
          <rect x="60" y="112" width="40" height="6" fill={p.bg} />
          <rect x="110" y="112" width="40" height="6" fill={p.bg} />
          <rect x="14" y="130" width="64" height="22" rx="4" fill={p.surface} stroke={p.line} strokeWidth="2" />
          <rect x="88" y="130" width="64" height="22" rx="4" fill={p.surface2} stroke={p.line} strokeWidth="2" />
          <rect x="162" y="130" width="64" height="22" rx="4" fill={p.surface} stroke={p.line} strokeWidth="2" />
        </>
      )}
      {template === "heritage" && (
        <>
          <rect x="0" y="0" width="240" height="3" fill={p.accent} />
          <rect x="92" y="10" width="56" height="8" rx="4" fill={p.text} />
          <rect x="62" y="26" width="18" height="4" rx="2" fill={p.muted} />
          <rect x="88" y="26" width="18" height="4" rx="2" fill={p.muted} />
          <rect x="114" y="26" width="18" height="4" rx="2" fill={p.muted} />
          <rect x="140" y="26" width="18" height="4" rx="2" fill={p.muted} />
          <line x1="0" y1="38" x2="240" y2="38" stroke={p.line} strokeWidth="2" />
          <rect x="106" y="48" width="28" height="3" rx="1.5" fill={p.accentText} />
          <line x1="104" y1="58" x2="136" y2="58" stroke={p.accent} />
          <rect x="52" y="64" width="136" height="10" rx="5" fill={p.text} />
          <rect x="74" y="80" width="92" height="10" rx="5" fill={p.text} />
          <rect x="82" y="97" width="76" height="4" rx="2" fill={p.muted} />
          <rect x="104" y="108" width="32" height="11" rx="1.5" fill={p.accent} />
          <rect x="40" y="126" width="160" height="26" fill={p.surface} stroke={p.line} />
          <rect x="45" y="131" width="150" height="16" fill={p.surface2} stroke={p.line} />
        </>
      )}
      {template === "smilebright" && (
        <>
          <circle cx="206" cy="24" r="40" fill={p.surface2} />
          <circle cx="24" cy="130" r="18" fill={p.accent} opacity="0.2" />
          <rect x="10" y="9" width="220" height="16" rx="8" fill={p.surface} stroke={p.line} strokeWidth="1.5" />
          <circle cx="22" cy="17" r="5" fill={p.accent} />
          <rect x="190" y="12" width="34" height="10" rx="5" fill={p.accent} />
          <rect x="18" y="40" width="58" height="10" rx="5" fill={p.surface} stroke={p.line} strokeWidth="1.5" />
          <rect x="18" y="58" width="100" height="11" rx="5.5" fill={p.text} />
          <rect x="18" y="74" width="78" height="11" rx="5.5" fill={p.text} />
          <rect x="18" y="94" width="38" height="9" rx="4.5" fill={p.surface} stroke={p.line} strokeWidth="1.5" />
          <rect x="60" y="94" width="38" height="9" rx="4.5" fill={p.surface} stroke={p.line} strokeWidth="1.5" />
          <rect x="18" y="110" width="46" height="15" rx="7.5" fill={p.accent} />
          <path d="M132 112c-8-30 8-62 40-62s52 22 44 52-30 36-52 30-26-6-32-20z" fill={p.surface2} stroke={p.surface} strokeWidth="5" />
          <circle cx="132" cy="106" r="11" fill={p.accent} stroke={p.surface} strokeWidth="3" />
          <rect x="18" y="134" width="48" height="18" rx="9" fill={p.surface} stroke={p.line} strokeWidth="1.5" />
          <rect x="74" y="134" width="48" height="18" rx="9" fill={p.surface2} stroke={p.line} strokeWidth="1.5" />
          <rect x="130" y="134" width="48" height="18" rx="9" fill={p.surface} stroke={p.line} strokeWidth="1.5" />
          <rect x="186" y="134" width="40" height="18" rx="9" fill={p.surface2} stroke={p.line} strokeWidth="1.5" />
        </>
      )}
      {template.startsWith("bento") && (
        <>
          <rect x="10" y="8" width="220" height="16" rx="8" fill={p.surface} stroke={p.line} />
          <rect x="20" y="13" width="34" height="6" rx="3" fill={p.text} />
          <rect x="190" y="12" width="32" height="8" rx="4" fill={p.accent} />
          <rect x="12" y="36" width="104" height="14" rx="3" fill={p.text} />
          <rect x="12" y="55" width="78" height="14" rx="3" fill={p.text} />
          <rect x="12" y="76" width="66" height="4" rx="2" fill={p.muted} />
          <rect x="12" y="86" width="50" height="4" rx="2" fill={p.muted} />
          <rect x="164" y="34" width="64" height="62" rx="12" fill={p.surface2} />
          <path d="M178 96V66a18 18 0 0 1 36 0v30z" fill={p.accent} opacity="0.7" />
          <rect x="12" y="102" width="68" height="46" rx="12" fill={p.surface2} />
          <rect x="88" y="102" width="68" height="46" rx="12" fill={p.surface} />
          <rect x="164" y="102" width="64" height="46" rx="12" fill={p.accent} />
          <rect x="20" y="110" width="30" height="5" rx="2.5" fill={p.text} />
          <rect x="96" y="110" width="30" height="5" rx="2.5" fill={p.text} />
          <rect x="172" y="110" width="30" height="5" rx="2.5" fill={p.onAccent} />
        </>
      )}
    </svg>
  );
}
