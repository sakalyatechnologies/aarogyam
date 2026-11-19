/** The Usage tab's page section: where staff spend time, per app, per role across all clinics, and each clinic's totals. */

import type { ClinicPages, MetricsRange, PageInsights, PageStat, RolePages } from "@aarogyam/api-client";
import { ApiErrorNotice, formatNumber } from "@aarogyam/app-kit";
import { Card, CardLink, DataTable, Skeleton, type DataTableColumn } from "@sakalya/ui";

import { usePageInsights } from "../../api.js";
import { RANGE_WORDS, one } from "./insight-parts.js";

/** Visible time in words: seconds, minutes or hours. `—` when hidden (fewer than 5 views). */
export function formatVisible(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${one.format(seconds)} s`;
  if (seconds < 3600) return `${one.format(seconds / 60)} min`;
  return `${one.format(seconds / 3600)} h`;
}

const ROLE_WORDS: Readonly<Record<string, string>> = {
  owner: "Owners",
  doctor: "Doctors",
  consultant: "Consultants",
  finance: "Finance",
  front_desk: "Front desk",
  assistant: "Assistants",
  custom: "Custom roles",
  support: "Support",
  onboarding: "Onboarding",
  analyst: "Analysts",
};
const roleWord = (app: string, key: string) => `${ROLE_WORDS[key] ?? key}${app === "console" ? " (console)" : ""}`;

const PAGE_COLUMNS: readonly DataTableColumn<PageStat>[] = [
  { id: "page", header: "Page", cell: (row) => <span className="font-mono text-xs">{row.route}</span>, sortValue: (row) => row.route },
  { id: "time", header: "Time visible", align: "end", cell: (row) => formatVisible(row.visible_ms), sortValue: (row) => row.visible_ms ?? -1 },
  { id: "views", header: "Views", align: "end", cell: (row) => formatNumber(row.views), sortValue: (row) => row.views },
  { id: "per-view", header: "Per view", align: "end", cell: (row) => formatVisible(row.avg_visible_ms), sortValue: (row) => row.avg_visible_ms ?? -1 },
];

const ROLE_COLUMNS: readonly DataTableColumn<RolePages>[] = [
  { id: "role", header: "Role", cell: (row) => roleWord(row.app, row.role_key), sortValue: (row) => row.role_key },
  { id: "time", header: "Time visible", align: "end", cell: (row) => formatVisible(row.visible_ms), sortValue: (row) => row.visible_ms ?? -1 },
  { id: "views", header: "Views", align: "end", cell: (row) => formatNumber(row.views), sortValue: (row) => row.views },
];

const CLINIC_COLUMNS: readonly DataTableColumn<ClinicPages>[] = [
  { id: "clinic", header: "Clinic", cell: (row) => <CardLink href={`/clinics/${row.org_id}`}>{row.name}</CardLink>, sortValue: (row) => row.name },
  { id: "time", header: "Time visible", align: "end", cell: (row) => formatVisible(row.visible_ms), sortValue: (row) => row.visible_ms ?? -1 },
  { id: "views", header: "Page views", align: "end", cell: (row) => formatNumber(row.views), sortValue: (row) => row.views },
];

export function PagesSection({ range }: { range: MetricsRange }) {
  const pages = usePageInsights(range);
  if (pages.isPending) {
    return (
      <div role="status" aria-label="Loading page usage">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (pages.isError) {
    return <ApiErrorNotice title="Couldn't load page usage" error={pages.error} onRetry={() => void pages.refetch()} />;
  }
  return <PagesBody pages={pages.data} range={range} />;
}

function PagesBody({ pages, range }: { pages: PageInsights; range: MetricsRange }) {
  const words = range === "7d" || range === "30d" ? RANGE_WORDS[range] : "yesterday and today";
  const empty = { title: "No pages counted yet", description: "Pages are counted when a signed-in tab is hidden." };
  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(["portal", "console"] as const).map((app) => (
          <Card key={app} title={app === "portal" ? "Top portal pages" : "Top console pages"}>
            <p className="mb-2 text-xs text-muted">Time the page was on screen and how often it was opened, {words}, all clinics together. Times from fewer than 5 views are hidden.</p>
            <DataTable
              caption={app === "portal" ? "Top portal pages" : "Top console pages"}
              columns={PAGE_COLUMNS}
              rows={pages.pages.filter((row) => row.app === app)}
              rowKey={(row) => row.route}
              defaultSort={{ columnId: "time", direction: "descending" }}
              pageSize={8}
              empty={empty}
            />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Time by role, all clinics">
          <p className="mb-2 text-xs text-muted">Across every clinic together; a clinic's own role breakdown is never shown. Custom roles count together.</p>
          <DataTable caption="Time by role across all clinics" columns={ROLE_COLUMNS} rows={pages.roles} rowKey={(row) => `${row.app} ${row.role_key}`} defaultSort={{ columnId: "time", direction: "descending" }} pageSize={8} empty={empty} />
        </Card>
        <Card title="Page time per clinic">
          <p className="mb-2 text-xs text-muted">Each clinic&apos;s totals across all its staff and pages: no role, no page.</p>
          <DataTable caption="Page time per clinic" columns={CLINIC_COLUMNS} rows={pages.clinics} rowKey={(row) => row.org_id} defaultSort={{ columnId: "time", direction: "descending" }} pageSize={8} empty={empty} />
        </Card>
      </div>
    </>
  );
}
