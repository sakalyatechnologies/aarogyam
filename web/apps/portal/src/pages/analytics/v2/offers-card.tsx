import { ApiErrorNotice, formatRupees } from "@aarogyam/app-kit";
import { BentoCard } from "@sakalya/ui";

import { Empty, Skeleton } from "../../../components/mk/index.js";
import { useShowMoney } from "../../today/v2/money.js";
import { useOfferReport } from "../queries.js";
import type { RangeWindow } from "./range.js";

const PURPOSE_LABEL: Readonly<Record<string, string>> = {
  patient_offer: "Patient offers",
  referral: "Friend referrals",
  referrer_reward: "Referrer rewards",
};

/** Offers: codes given, redeemed and reversed, what they took off and the bills they sat on. Counts and paise only. */
export function OffersCard({ win }: { win: RangeWindow }) {
  const [shown] = useShowMoney();
  const report = useOfferReport({ from: win.from, to: win.to });
  const data = report.data;
  return (
    <BentoCard title="Offers" subtitle="Given, redeemed and reversed in this range">
      {report.isError && data === undefined ? (
        <ApiErrorNotice title="Couldn't load offers" error={report.error} onRetry={() => void report.refetch()} />
      ) : data === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : data.by_purpose.every((p) => p.issued === 0 && p.redeemed === 0 && p.reversed === 0) ? (
        <Empty art="chart" title="No offers in this range">Offers show here once patients are given codes.</Empty>
      ) : (
        <>
          <table className="an2-table">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Given</th>
                <th scope="col">Redeemed</th>
                <th scope="col">Reversed</th>
                <th scope="col">Discount</th>
                {shown && data.by_purpose.some((p) => p.revenue_paise != null) ? <th scope="col">Billed</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.by_purpose.map((p) => (
                <tr key={p.purpose}>
                  <th scope="row">{PURPOSE_LABEL[p.purpose] ?? p.purpose}</th>
                  <td>{p.issued}</td>
                  <td>{p.redeemed}</td>
                  <td>{p.reversed}</td>
                  <td>{shown ? formatRupees(p.discount_paise) : "••••"}</td>
                  {shown && p.revenue_paise != null ? <td>{formatRupees(p.revenue_paise)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="an2-note">{data.new_patients_referred} new patients came through a friend's code.</p>
        </>
      )}
    </BentoCard>
  );
}
