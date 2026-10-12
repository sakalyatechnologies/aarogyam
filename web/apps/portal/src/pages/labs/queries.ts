/** Lab work: orders, labs and their contacts, payments. Kept apart so this screen never touches the other pages' query files. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type LabContactLogEntry,
  type LabContactValues,
  type LabOrder,
  type LabOrderFilter,
  type LabVendorValues,
  type NewLabOrder,
  type NewLabPayment,
  type Reason,
} from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";
import type { Move } from "./stages.js";

/** Everything a lab change can make stale, Today's open-lab card and the bell included. */
function refresh(queryClient: QueryClient, orgId: string, ...parts: readonly string[]) {
  for (const key of ["lab-orders", "open-labs", ...parts]) {
    void queryClient.invalidateQueries({ queryKey: [key, orgId] });
  }
}

export function useLabOrders(filter: LabOrderFilter, enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["lab-orders", access.org_id, filter],
    queryFn: ({ signal }) => unwrap(api.listLabOrders(filter, { signal })),
    enabled,
  });
}

export function useLabOrderById(id: string | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["lab-orders", access.org_id, "one", id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no order")) : unwrap(api.getLabOrder(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useLabVendors(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["lab-vendors", access.org_id], queryFn: ({ signal }) => unwrap(api.listLabVendors({ signal })), enabled });
}

export function useCreateLabOrder() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewLabOrder) => unwrap(api.createLabOrder(input)),
    onSuccess: () => {
      refresh(queryClient, access.org_id, "lab-balance");
    },
  });
}

/** Runs the calls of a move one after another and returns the order as it ends up. */
export function useMoveLabOrder() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ order, moves }: { order: Pick<LabOrder, "id">; moves: readonly Move[] }) => {
      let last: LabOrder | undefined;
      for (const move of moves) {
        last = await unwrap(
          move.kind === "status"
            ? api.setLabOrderStatus(order.id, { status: move.status, ...(move.stage === undefined ? {} : { stage: move.stage }) })
            : api.updateLabOrder(order.id, { stage: move.stage }),
        );
      }
      return last;
    },
    onSettled: () => {
      refresh(queryClient, access.org_id);
    },
  });
}

export function useSetLabOrderStatus() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: LabOrder["status"]; note?: string }) =>
      unwrap(api.setLabOrderStatus(id, { status, ...(note === undefined ? {} : { note }) })),
    onSettled: () => {
      refresh(queryClient, access.org_id, "lab-balance");
    },
  });
}

export function useRemindLab() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.remindLab(id)),
    onSettled: () => {
      refresh(queryClient, access.org_id);
    },
  });
}

export function useLogLabContact() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entry }: { id: string; entry: LabContactLogEntry }) => unwrap(api.logLabContact(id, entry)),
    onSuccess: () => {
      refresh(queryClient, access.org_id);
    },
  });
}

export function useSaveLabVendor() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: string | undefined; values: LabVendorValues }) =>
      unwrap(id === undefined ? api.createLabVendor(values) : api.updateLabVendor(id, values)),
    onSuccess: () => {
      refresh(queryClient, access.org_id, "lab-vendors");
    },
  });
}

export function useSaveLabContact() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vendorId, id, values }: { vendorId: string; id?: string | undefined; values: LabContactValues }) =>
      unwrap(id === undefined ? api.createLabContact(vendorId, values) : api.updateLabContact(id, values)),
    onSuccess: () => {
      refresh(queryClient, access.org_id, "lab-vendors");
    },
  });
}

export function useLabBalance(vendorId: string | undefined, enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["lab-balance", access.org_id, vendorId],
    queryFn: ({ signal }) => (vendorId === undefined ? Promise.reject(new Error("no lab")) : unwrap(api.getLabBalance(vendorId, { signal }))),
    enabled: enabled && vendorId !== undefined,
  });
}

export function useLabPayments(vendorId: string | undefined, enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["lab-payments", access.org_id, vendorId],
    queryFn: ({ signal }) => unwrap(api.listLabPayments(vendorId, { signal })),
    enabled: enabled && vendorId !== undefined,
  });
}

/** A payment also makes a lab expense, so billing's expense list and Analytics are stale too. */
function refreshPayments(queryClient: QueryClient, orgId: string) {
  refresh(queryClient, orgId, "lab-balance", "lab-payments", "expenses", "analytics");
}

export function useRecordLabPayment() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewLabPayment) => unwrap(api.recordLabPayment(input)),
    onSuccess: () => {
      refreshPayments(queryClient, access.org_id);
    },
  });
}

export function useVoidLabPayment() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: Reason }) => unwrap(api.voidLabPayment(id, reason)),
    onSuccess: () => {
      refreshPayments(queryClient, access.org_id);
    },
  });
}
