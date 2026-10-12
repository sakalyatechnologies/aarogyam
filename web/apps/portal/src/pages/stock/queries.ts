/** Stock: levels, items, suppliers, deliveries and use. Kept apart from `queries.ts` so the stock work never touches the other tabs' files. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  inventoryItemId,
  unwrap,
  type AdjustStock,
  type ExpireBatch,
  type InventoryItemAlertChanges,
  type InventoryItemId,
  type InventoryItemValues,
  type ReceiveStock,
  type StockBatchId,
  type UseStock,
} from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

/** What every stock change makes stale: the summary, the lists and the item itself. */
function refresh(queryClient: QueryClient, orgId: string, itemId?: InventoryItemId) {
  void queryClient.invalidateQueries({ queryKey: ["stock", orgId] });
  void queryClient.invalidateQueries({ queryKey: ["expiring", orgId] });
  if (itemId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: ["inventory-item", orgId, itemId] });
  }
}

export function useStock(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["stock", access.org_id], queryFn: ({ signal }) => unwrap(api.getStock({ signal })), enabled });
}

/** Per-item usage, days of cover and the reorder list (`GET /stock/analytics`). Under ["stock", org], so any stock change refreshes it. */
export function useStockAnalytics(enabled = true, itemId?: InventoryItemId) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["stock", access.org_id, "analytics", itemId ?? "all"],
    queryFn: ({ signal }) => unwrap(api.getStockAnalytics(itemId === undefined ? undefined : { itemId }, { signal })),
    enabled,
  });
}

/** The low and critical items with days of cover when it is known (`GET /stock/low`). */
export function useLowStock(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["stock", access.org_id, "low"], queryFn: ({ signal }) => unwrap(api.listLowStock({ signal })), enabled });
}

/** Saves an item's lead time and alert switch (`PATCH /inventory-items/{id}/alerts`, needs `inventory.manage`). */
export function useChangeItemAlerts(id: InventoryItemId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InventoryItemAlertChanges) => unwrap(api.changeInventoryItemAlerts(id, input)),
    onSuccess: () => {
      refresh(queryClient, access.org_id, id);
    },
  });
}

export function useExpiring(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["expiring", access.org_id], queryFn: ({ signal }) => unwrap(api.listExpiring(undefined, { signal })), enabled });
}

export function useInventoryItem(id: InventoryItemId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["inventory-item", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no item")) : unwrap(api.getInventoryItem(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useSuppliers(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["suppliers", access.org_id], queryFn: ({ signal }) => unwrap(api.listSuppliers({ signal })), enabled });
}

export function useAddInventoryItem() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InventoryItemValues) => unwrap(api.addInventoryItem(input)),
    onSuccess: () => {
      refresh(queryClient, access.org_id);
    },
  });
}

export function useChangeInventoryItem(id: InventoryItemId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InventoryItemValues) => unwrap(api.changeInventoryItem(id, input)),
    onSuccess: () => {
      refresh(queryClient, access.org_id, id);
    },
  });
}

export function useReceiveStock() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiveStock) => unwrap(api.receiveStock(input)),
    onSuccess: (_change, input) => {
      refresh(queryClient, access.org_id, inventoryItemId.parse(input.item_id));
    },
  });
}

export function useUseStock() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UseStock) => unwrap(api.useStock(input)),
    onSuccess: (_change, input) => {
      refresh(queryClient, access.org_id, inventoryItemId.parse(input.item_id));
    },
  });
}

export function useAdjustStock() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdjustStock) => unwrap(api.adjustStock(input)),
    onSuccess: (_change, input) => {
      refresh(queryClient, access.org_id, inventoryItemId.parse(input.item_id));
    },
  });
}

export function useExpireBatch() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: StockBatchId; input: ExpireBatch }) => unwrap(api.expireBatch(id, input)),
    onSuccess: (change) => {
      refresh(queryClient, access.org_id, change.stock.item.id);
    },
  });
}
