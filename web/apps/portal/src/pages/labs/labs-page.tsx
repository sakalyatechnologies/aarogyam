import { BellRing, Building2, FlaskConical, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import type { LabOrderFilter } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Select } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { EmptyState, MkCard, PageHeader, Segments, SkeletonList, StatTile } from "../../components/mk/index.js";
import { LabsDirectory } from "./labs-directory.js";
import { NewOrderDialog } from "./new-order-dialog.js";
import { OrderCard } from "./order-card.js";
import { OrderDrawer } from "./order-drawer.js";
import { useLabOrders, useLabVendors, useMoveLabOrder } from "./queries.js";
import { planMove } from "./stages.js";
import "./labs.css";

type Tab = "orders" | "labs";
type Show = "open" | "overdue" | "all";

const TABS = [
  { value: "orders", label: "Work orders" },
  { value: "labs", label: "Labs" },
] as const;
const SHOW = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "all", label: "All" },
] as const;

/**
 * Lab work (New look): the cases at labs with their five-step tracker, the labs and the people there, and what each is owed.
 * Needs `labs.read`; sending, moving, reminding and editing need `labs.write`.
 */
export function LabsPage() {
  const { can } = useClinic();
  useDocumentTitle("Lab work", "Aarogyam");
  const allowed = can("labs.read");
  const canWrite = can("labs.write");
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("orders");
  const [show, setShow] = useState<Show>("open");
  const [vendorId, setVendorId] = useState("all");
  const [selected, setSelected] = useState<string>();
  const [sending, setSending] = useState(params.get("new") === "1");
  const [addingLab, setAddingLab] = useState(false);

  const filter: LabOrderFilter = {
    ...(show === "open" ? { open: true } : show === "overdue" ? { overdue: true } : {}),
    ...(vendorId === "all" ? {} : { vendorId }),
  };
  const orders = useLabOrders(filter, allowed);
  const open = useLabOrders({ open: true }, allowed);
  const vendors = useLabVendors(allowed);
  const move = useMoveLabOrder();

  if (!allowed) {
    return (
      <>
        <PageHeader eyebrow="Labs" title="Lab work" subtitle="Cases at labs and the labs you work with" />
        <MkCard>
          <EmptyState art="lab" title="Lab work isn't available to your role" description="Ask the clinic owner for the labs permission." />
        </MkCard>
      </>
    );
  }

  const cases = open.data?.items ?? [];
  const atLab = cases.filter((o) => o.status === "sent" || o.status === "in_progress").length;
  const labOptions = [{ value: "all", label: "All labs" }, ...(vendors.data?.items.map((v) => ({ value: v.id, label: v.name })) ?? [])];
  const items = orders.data?.items ?? [];

  const closeSend = () => {
    setSending(false);
    if (params.has("new")) {
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Labs"
        title="Lab work"
        subtitle="Labs you work with and every case you send"
        actions={
          canWrite ? (
            tab === "orders" ? (
              <Button
                icon={<Plus aria-hidden="true" size={16} />}
                onClick={() => {
                  setSending(true);
                }}
              >
                Send work
              </Button>
            ) : (
              <Button
                icon={<Plus aria-hidden="true" size={16} />}
                onClick={() => {
                  setAddingLab(true);
                }}
              >
                Add lab
              </Button>
            )
          ) : undefined
        }
      />
      <div className="mk-stats" aria-label="Lab work summary">
        <StatTile label="Cases at labs" value={atLab} icon={<FlaskConical size={16} />} />
        <StatTile label="Late" value={cases.filter((o) => o.late).length} tone={cases.some((o) => o.late) ? "warn" : undefined} icon={<BellRing size={16} />} />
        <StatTile label="Back, ready to fit" value={cases.filter((o) => o.status === "received").length} icon={<Truck size={16} />} />
        <StatTile label="Partner labs" value={vendors.data?.items.length ?? "—"} icon={<Building2 size={16} />} />
      </div>
      <div className="lb-bar-top">
        <Segments label="Lab work view" options={TABS} value={tab} onChange={setTab} />
        {tab === "orders" ? (
          <div className="lb-filters">
            <Segments label="Show" options={SHOW} value={show} onChange={setShow} />
            <Select aria-label="Lab" options={labOptions} value={vendorId} onValueChange={setVendorId} />
          </div>
        ) : null}
      </div>

      {tab === "orders" ? (
        <MkCard title="Cases" hint="Tap the next step when a case moves; open one to remind the lab or log a call">
          {orders.isPending ? (
            <SkeletonList label="Loading lab orders" />
          ) : orders.isError ? (
            <ApiErrorNotice
              title="Couldn't load the lab orders"
              error={orders.error}
              onRetry={() => {
                void orders.refetch();
              }}
            />
          ) : items.length === 0 ? (
            <EmptyState
              art="lab"
              title={show === "overdue" ? "Nothing is overdue" : show === "open" ? "No cases at labs right now" : "No lab orders yet"}
              description={show === "overdue" ? "Every case at a lab is on time." : canWrite ? "Send work to a lab and it shows up here with its progress." : undefined}
              action={
                canWrite && show !== "overdue" ? (
                  <Button
                    onClick={() => {
                      setSending(true);
                    }}
                  >
                    Send work
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="lb-list" aria-label="Lab orders">
              {items.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  busy={move.isPending}
                  onOpen={() => {
                    setSelected(order.id);
                  }}
                  onNext={
                    canWrite
                      ? (target) => {
                          move.mutate({ order, moves: planMove(order, target) });
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
        </MkCard>
      ) : (
        <LabsDirectory
          openOrders={cases}
          adding={addingLab}
          onAdd={() => {
            setAddingLab(true);
          }}
          onAddClose={() => {
            setAddingLab(false);
          }}
        />
      )}

      <OrderDrawer
        orderId={selected}
        onClose={() => {
          setSelected(undefined);
        }}
      />
      {canWrite && sending ? <NewOrderDialog open onClose={closeSend} /> : null}
    </>
  );
}
