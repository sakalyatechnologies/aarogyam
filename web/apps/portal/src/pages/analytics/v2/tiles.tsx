import type { ReactNode } from "react";

import { MoneyEye, useShowMoney } from "../../today/v2/money.js";

/** One key number in the ribbon. A money tile carries the eye and stays masked until it is pressed. */
export function Tile({ label, value, hint, icon, money = false, meter }: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; money?: boolean; meter?: number | null }) {
  const [shown] = useShowMoney();
  const masked = money && !shown;
  return (
    <li className="an2-kpi" data-money={money ? "1" : undefined}>
      <div className="an2-kpi-top">
        <span className="an2-kpi-ico" aria-hidden="true">
          {icon}
        </span>
        {money ? <MoneyEye what={label.toLowerCase()} className="an2-eye" /> : null}
      </div>
      <p className="an2-kpi-label">{label}</p>
      <p className="an2-kpi-value">
        {masked ? (
          <>
            <span aria-hidden="true">₹•••••</span>
            <span className="mk-sr">Hidden</span>
          </>
        ) : (
          value
        )}
      </p>
      <p className="an2-kpi-hint">{masked ? "Tap the eye to show" : hint}</p>
      {meter === undefined || meter === null ? null : (
        <span className="an-meter an2-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, meter)}>
          <span style={{ width: `${String(Math.min(100, meter))}%` }} />
        </span>
      )}
    </li>
  );
}
