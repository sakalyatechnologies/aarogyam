/** Purchase orders and the stock import: the lists, the lifecycle changes and the two-step file import. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type CommitStockImport,
  type NewPurchaseOrder,
  type PurchaseOrderChanges,
  type PurchaseOrderId,
  type ReceivePurchaseOrder,
} from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

export function usePurchaseOrders(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["purchase-orders", access.org_id], queryFn: ({ signal }) => unwrap(api.listPurchaseOrders(undefined, { signal })), enabled });
}

/** An order's change can also change stock (a receive), so both lists go stale. */
function useRefreshOrders() {
  const { access } = useClinic();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["purchase-orders", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["stock", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["expiring", access.org_id] });
  };
}

export function useCreatePurchaseOrder() {
  const { api } = useClinic();
  const refresh = useRefreshOrders();
  return useMutation({ mutationFn: (input: NewPurchaseOrder) => unwrap(api.createPurchaseOrder(input)), onSuccess: refresh });
}

export function useUpdatePurchaseOrder() {
  const { api } = useClinic();
  const refresh = useRefreshOrders();
  return useMutation({
    mutationFn: ({ id, input }: { id: PurchaseOrderId; input: PurchaseOrderChanges }) => unwrap(api.updatePurchaseOrder(id, input)),
    onSuccess: refresh,
  });
}

export function useDeletePurchaseOrder() {
  const { api } = useClinic();
  const refresh = useRefreshOrders();
  return useMutation({ mutationFn: (id: PurchaseOrderId) => unwrap(api.deletePurchaseOrder(id)), onSuccess: refresh });
}

export function useReceivePurchaseOrder() {
  const { api } = useClinic();
  const refresh = useRefreshOrders();
  return useMutation({
    mutationFn: ({ id, input }: { id: PurchaseOrderId; input: ReceivePurchaseOrder }) => unwrap(api.receivePurchaseOrder(id, input)),
    onSuccess: refresh,
  });
}

/** Step one of the import: the file is checked, nothing is saved. */
export function usePreviewStockImport() {
  const { api } = useClinic();
  return useMutation({ mutationFn: (form: FormData) => unwrap(api.previewStockImport(form)) });
}

/** Step two: applies the preview by its token; the stock lists go stale. */
export function useCommitStockImport() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CommitStockImport) => unwrap(api.commitStockImport(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock", access.org_id] });
      void queryClient.invalidateQueries({ queryKey: ["expiring", access.org_id] });
    },
  });
}
