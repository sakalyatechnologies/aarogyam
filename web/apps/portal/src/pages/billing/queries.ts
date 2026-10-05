/** Billing: price list, invoices, payments and reports. Kept separate from `queries.ts` so this
 * work and the patients/visits work in progress elsewhere never touch the same file. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type DateRange,
  type InvoiceEdit,
  type InvoiceId,
  type NewInvoice,
  type NewPayment,
  type PatientId,
  type PaymentId,
  type PriceItemId,
  type PriceItemValues,
} from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";
import { REFERENCE } from "../../lib/cache-policy.js";

export function usePriceItems() {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["price-items", access.org_id], queryFn: ({ signal }) => unwrap(api.listPriceItems({ signal })), ...REFERENCE });
}

export function useAddPriceItem() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PriceItemValues) => unwrap(api.addPriceItem(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price-items", access.org_id] }),
  });
}

export function useChangePriceItem() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: PriceItemId; input: PriceItemValues }) => unwrap(api.changePriceItem(id, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price-items", access.org_id] }),
  });
}

interface InvoiceFilter {
  status?: string | undefined;
  patientId?: PatientId | undefined;
}

export function useInvoices(filter: InvoiceFilter = {}, enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["invoices", access.org_id, filter.status, filter.patientId],
    queryFn: ({ signal }) => unwrap(api.listInvoices(filter, { signal })),
    enabled,
  });
}

export function useInvoice(id: InvoiceId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["invoice", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no invoice")) : unwrap(api.getInvoice(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useCreateInvoice() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewInvoice) => unwrap(api.createInvoice(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] }),
  });
}

function invalidateInvoice(queryClient: ReturnType<typeof useQueryClient>, orgId: string, id: InvoiceId) {
  void queryClient.invalidateQueries({ queryKey: ["invoices", orgId] });
  void queryClient.invalidateQueries({ queryKey: ["invoice", orgId, id] });
}

export function useEditInvoice(id: InvoiceId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: InvoiceEdit) => unwrap(api.editInvoice(id, changes)),
    onSuccess: () => {
      invalidateInvoice(queryClient, access.org_id, id);
    },
  });
}

export function useIssueInvoice(id: InvoiceId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.issueInvoice(id)),
    onSuccess: () => {
      invalidateInvoice(queryClient, access.org_id, id);
    },
  });
}

export function useVoidInvoice(id: InvoiceId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => unwrap(api.voidInvoice(id, { reason })),
    onSuccess: () => {
      invalidateInvoice(queryClient, access.org_id, id);
    },
  });
}

export function usePayments(range: Partial<DateRange> = {}) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["payments", access.org_id, range.from, range.to], queryFn: ({ signal }) => unwrap(api.listPayments(range, { signal })) });
}

export function usePayment(id: PaymentId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["payment", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no payment")) : unwrap(api.getPayment(id, { signal }))),
    enabled: id !== undefined,
  });
}

/** Records a payment; invalidates the invoices it allocates to as well as the payments list. */
export function useRecordPayment() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: NewPayment; idempotencyKey: string }) => unwrap(api.recordPayment(input, idempotencyKey)),
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({ queryKey: ["payments", access.org_id] });
      for (const allocation of payment.allocations) {
        void queryClient.invalidateQueries({ queryKey: ["invoice", access.org_id, allocation.invoice_id] });
      }
      void queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] });
    },
  });
}

export function useVoidPayment(id: PaymentId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => unwrap(api.voidPayment(id, { reason })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payments", access.org_id] });
      void queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] });
    },
  });
}

export function useCollections(range: Partial<DateRange> = {}) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["collections", access.org_id, range.from, range.to],
    queryFn: ({ signal }) => unwrap(api.getCollections(range, { signal })),
  });
}

export function usePendingReport(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["pending-report", access.org_id], queryFn: ({ signal }) => unwrap(api.getPendingReport({ signal })), enabled });
}

export function useTodayMoney(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["today-money", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getTodayMoney({ signal })),
    refetchInterval: 60_000,
    enabled,
  });
}
