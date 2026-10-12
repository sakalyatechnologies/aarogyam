import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { unwrap, type Invoice, type PatientId } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { REFERENCE } from "../../../lib/cache-policy.js";
import { useDentalChart } from "../../../queries.js";
import { useInvoices } from "../../billing/queries.js";
import { invoiceItems, problemWith, seedLines, totalOf, type BillLine } from "./bill-lines.js";

/**
 * The visit's bill as editable lines, shared by the End visit step (a suggested total), Send for payment and Collect payment.
 * The lines start from today's chart entries and the price list (or the visit's draft bill) and stay as the doctor edits them.
 * `save` writes them to the visit's draft bill, making the bill when there is none; issuing is the caller's step.
 */
export function useBillDraft(input: { patientId: PatientId; visitId: string | undefined; /** `active` while the visit is open (a suggestion), `ended` once it is closed (the bill itself). */ stage: "active" | "ended"; enabled: boolean }) {
  const { api, access, can } = useClinic();
  const queryClient = useQueryClient();
  const { patientId, visitId, stage } = input;
  const scope = `${visitId ?? ""}|${stage}`;
  const on = input.enabled && visitId !== undefined && can("billing.read");
  const chart = useDentalChart(on && can("clinical.read") ? patientId : undefined);
  const prices = useQuery({
    queryKey: ["price-items", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listPriceItems({ signal })),
    enabled: on,
    ...REFERENCE,
  });
  const invoices = useInvoices({ patientId }, on);
  const listed = invoices.data?.items.find((i) => i.encounter_id === visitId && i.status !== "void");
  // The list leaves the lines out; the bill itself has them.
  const detail = useQuery({
    queryKey: ["invoice", access.org_id, listed?.id],
    queryFn: ({ signal }) => (listed === undefined ? Promise.reject(new Error("no bill")) : unwrap(api.getInvoice(listed.id, { signal }))),
    enabled: on && listed !== undefined,
  });
  const bill = listed === undefined ? undefined : detail.data?.id === listed.id ? detail.data : listed;

  // Ending the visit may have made a draft bill from a fee: read the bills again before taking the lines from them.
  const [freshFor, setFreshFor] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!on || stage !== "ended") return;
    let live = true;
    void Promise.all([queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] }), queryClient.invalidateQueries({ queryKey: ["invoice", access.org_id] }), queryClient.invalidateQueries({ queryKey: ["dental-chart", access.org_id, patientId] })]).then(() => {
      if (live) setFreshFor(scope);
    });
    return () => {
      live = false;
    };
  }, [on, stage, scope, queryClient, access.org_id, patientId]);

  const ready = on && invoices.isSuccess && (listed === undefined || detail.isSuccess || detail.isError) && prices.isSuccess && (chart.isSuccess || chart.isError || !can("clinical.read")) && (stage === "active" || freshFor === scope);
  const seeded = (() => {
    if (!ready) return undefined;
    return seedLines({ entries: chart.data?.current ?? [], visitId, priceList: prices.data.items, draft: bill });
  })();
  // Seeded once per visit: a refetch (after a save) must not replace what the doctor typed or re-key the lines.
  const [snapshot, setSnapshot] = useState<{ scope: string; value: ReturnType<typeof seedLines> | undefined }>({ scope: "", value: undefined });
  if (scope !== snapshot.scope || (snapshot.value === undefined && seeded !== undefined)) {
    setSnapshot({ scope, value: seeded });
  }
  // While the visit is open the suggestion follows the chart as it is charted; once ended the lines stay as they were first made.
  const base = stage === "active" ? seeded : snapshot.scope === scope ? snapshot.value : undefined;

  const [edited, setEdited] = useState<{ scope: string; lines: BillLine[]; discount: string } | undefined>(undefined);
  const mine = edited?.scope === scope ? edited : undefined;
  const lines = mine?.lines ?? base?.lines ?? [];
  const discount = mine?.discount ?? base?.discount ?? "";

  const [savedCopy, setSaved] = useState<{ visitId: string | undefined; invoice: Invoice } | undefined>(undefined);
  const saved = savedCopy !== undefined && savedCopy.visitId === visitId ? savedCopy.invoice : undefined;
  // The list as the server has it, unless it has not caught up with a save or issue made a moment ago.
  const current = bill === undefined || (saved !== undefined && saved.id === bill.id && bill.status === "draft" && saved.status !== "draft") ? (saved ?? bill) : bill;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["invoice", access.org_id] });
  };

  return {
    ready: base !== undefined,
    lines,
    discount,
    setLines: (next: BillLine[]) => {
      setEdited({ scope, lines: next, discount });
    },
    setDiscount: (next: string) => {
      setEdited({ scope, lines, discount: next });
    },
    priceList: prices.data?.items ?? [],
    bill: current,
    total: totalOf(lines, discount),
    problem: problemWith(lines, discount),
    /** Writes the lines to the visit's draft bill (making it when there is none). An issued bill is returned as it is. */
    save: async (): Promise<Invoice> => {
      if (visitId === undefined) throw new Error("no visit");
      if (current !== undefined && current.status !== "draft") return current;
      const items = invoiceItems(lines, discount);
      const invoice =
        current === undefined
          ? await unwrap(api.createInvoice({ patient_id: patientId, encounter_id: visitId, items }))
          : await unwrap(api.editInvoice(current.id, { items }));
      setSaved({ visitId, invoice });
      refresh();
      return invoice;
    },
    /** Makes a draft the final bill; the saved copy follows so a retry does not issue twice. */
    issue: async (draft: Invoice): Promise<Invoice> => {
      if (draft.status !== "draft") return draft;
      const invoice = await unwrap(api.issueInvoice(draft.id));
      setSaved({ visitId, invoice });
      refresh();
      return invoice;
    },
  };
}

export type BillDraft = ReturnType<typeof useBillDraft>;
