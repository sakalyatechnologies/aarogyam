import { ShieldCheck } from "lucide-react";

export function ConsoleBrand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary">
        <ShieldCheck aria-hidden="true" className="size-6" />
      </span>
      <div className="leading-tight">
        <p className="text-lg font-extrabold tracking-tight text-text">Sakalya Console</p>
        <p className="text-xs text-muted">Aarogyam operations</p>
      </div>
    </div>
  );
}
