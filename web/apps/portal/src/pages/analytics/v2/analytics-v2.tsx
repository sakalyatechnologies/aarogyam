import { useSearchParams } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { Field, PageHeader, Pills, Tabs } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { DatePicker } from "../../../components/mk/date-picker.js";
import { useTodayDate } from "../../../lib/patients.js";
import { MoneyTab } from "./money-tab.js";
import { PracticeTab } from "./practice-tab.js";
import { RANGES, customProblem, parseRange, parseTab, windowLabel, windowOf, type RangeKey, type TabKey } from "./range.js";
import "../analytics.css";
import "./analytics-v2.css";

/**
 * Analytics in the New look: a Practice tab (patients, procedures, chair use, busy hours) and a Money tab
 * (income, collections, what is owed, expenses). The range and the tab live in the URL
 * (`?range=7d&tab=money`, or `?range=custom&from=2026-10-01&to=2026-10-31`), so a reload keeps them. Money needs
 * `finance.view`; without it the tab is not offered.
 */
export function AnalyticsV2() {
  const { session, can } = useClinic();
  useDocumentTitle("Analytics", session.clinic.name);
  const today = useTodayDate();
  const [params, setParams] = useSearchParams();
  const moneyAllowed = can("finance.view");
  const range = parseRange(params.get("range"));
  const custom = { from: params.get("from") ?? "", to: params.get("to") ?? "" };
  const win = windowOf(range, today, custom);
  const tab = parseTab(params.get("tab"), moneyAllowed);
  const problem = range === "custom" ? customProblem(custom.from, custom.to, today) : undefined;

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };
  const chooseRange = (value: RangeKey) => {
    // Custom starts from the range on screen, so it is valid at once; the presets need no dates.
    update(value === "custom" ? { range: value, from: win.from, to: win.to } : { range: value, from: null, to: null });
  };

  const practice = <PracticeTab win={win} />;
  return (
    <div className="mk-panel an-page an2">
      <PageHeader
        variant="display"
        title="Analytics"
        subtitle={`${tab === "money" ? "Money in and out of the clinic" : "Patients, procedures and how the chairs are used"}, ${windowLabel(win)}.`}
        end={<Pills<RangeKey> label="Range" options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={range} onValueChange={chooseRange} />}
      />
      {range === "custom" ? (
        <div className="an2-custom" role="group" aria-label="Custom range">
          <Field label="Start date" id="an2-from">
            <DatePicker
              id="an2-from"
              label="Start date"
              value={custom.from}
              max={custom.to === "" ? today : custom.to}
              today={today}
              onChange={(from) => {
                update({ from });
              }}
            />
          </Field>
          <Field label="End date" id="an2-to">
            <DatePicker
              id="an2-to"
              label="End date"
              value={custom.to}
              min={custom.from === "" ? undefined : custom.from}
              max={today}
              today={today}
              onChange={(to) => {
                update({ to });
              }}
            />
          </Field>
          {problem === undefined ? null : (
            <p role="alert" className="an2-custom-problem">
              {problem} Showing the last 6 months meanwhile.
            </p>
          )}
        </div>
      ) : null}
      {moneyAllowed ? (
        <Tabs<TabKey>
          label="Analytics area"
          value={tab}
          onValueChange={(v) => {
            update({ tab: v });
          }}
          items={[
            { value: "practice", label: "Practice", content: <div className="an2-panel">{practice}</div> },
            { value: "money", label: "Money", content: <div className="an2-panel"><MoneyTab win={win} /></div> },
          ]}
        />
      ) : (
        practice
      )}
    </div>
  );
}
