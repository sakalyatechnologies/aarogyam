import { useSearchParams } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { PageHeader, Pills, Tabs } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useTodayDate } from "../../../lib/patients.js";
import { MoneyTab } from "./money-tab.js";
import { PracticeTab } from "./practice-tab.js";
import { RANGES, parseRange, parseTab, type RangeKey, type TabKey } from "./range.js";
import "../analytics.css";
import "./analytics-v2.css";

/**
 * Analytics in the New look: a Practice tab (patients, procedures, chair use, busy hours) and a Money tab
 * (income, collections, what is owed, expenses). The range and the tab live in the URL
 * (`?range=6m&tab=money`), so a reload keeps them. Money needs `finance.view`; without it the tab is not offered.
 */
export function AnalyticsV2() {
  const { session, can } = useClinic();
  useDocumentTitle("Analytics", session.clinic.name);
  const today = useTodayDate();
  const [params, setParams] = useSearchParams();
  const moneyAllowed = can("finance.view");
  const range = parseRange(params.get("range"));
  const tab = parseTab(params.get("tab"), moneyAllowed);

  const update = (key: "range" | "tab", value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const practice = <PracticeTab range={range} today={today} />;
  return (
    <div className="mk-panel an-page an2">
      <PageHeader
        variant="display"
        title="Analytics"
        subtitle={tab === "money" ? "Money in and out of the clinic." : "Patients, procedures and how the chairs are used."}
        end={
          <Pills<RangeKey>
            label="Range"
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            value={range}
            onValueChange={(v) => {
              update("range", v);
            }}
          />
        }
      />
      {moneyAllowed ? (
        <Tabs<TabKey>
          label="Analytics area"
          value={tab}
          onValueChange={(v) => {
            update("tab", v);
          }}
          items={[
            { value: "practice", label: "Practice", content: <div className="an2-panel">{practice}</div> },
            { value: "money", label: "Money", content: <div className="an2-panel"><MoneyTab range={range} today={today} /></div> },
          ]}
        />
      ) : (
        practice
      )}
    </div>
  );
}
