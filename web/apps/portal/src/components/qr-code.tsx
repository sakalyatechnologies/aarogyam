/**
 * A QR code, drawn as plain SVG rectangles (no `dangerouslySetInnerHTML`). Generic: no Aarogyam
 * or clinic concept in it, so moving it to `sakalya-web` later (AGENTS.md rule 13) is mechanical.
 * Uses `qrcode-generator` (zero dependencies, ships its own types) because implementing QR's
 * Reed–Solomon error correction from scratch isn't worth it for one print layout.
 */
import qrcode from "qrcode-generator";

export interface QrCodeProps {
  /** The text or URL to encode. */
  value: string;
  /** Rendered size in pixels (square). */
  size?: number;
  /** Accessible label; the code is otherwise decorative to screen readers. */
  label: string;
  className?: string;
}

export function QrCode({ value, size = 120, label, className }: QrCodeProps) {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  const cells: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (code.isDark(row, col)) {
        cells.push(`M${String(col)},${String(row)}h1v1h-1z`);
      }
    }
  }
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${String(count)} ${String(count)}`}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width={count} height={count} fill="#ffffff" />
      <path d={cells.join(" ")} fill="#000000" />
    </svg>
  );
}
