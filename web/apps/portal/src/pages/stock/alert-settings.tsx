import { useState } from "react";

import { apiErrorOf, type InventoryItemId } from "@aarogyam/api-client";
import { Button, Field, Switch, TextInput, useToast } from "@sakalya/ui";

import { useChangeItemAlerts, useStockAnalytics } from "./queries.js";

/** One item's alert settings (New look): how many days a delivery takes, and whether it raises stock alerts. */
export function AlertSettings({ itemId }: { itemId: InventoryItemId }) {
  const analytics = useStockAnalytics(true, itemId);
  const row = analytics.data?.items[0];
  if (row === undefined) return null;
  // Re-keyed on the saved values, so the form starts from what the server holds.
  return <AlertForm key={`${String(row.lead_time_days)}-${String(row.alerts_enabled)}`} itemId={itemId} leadTime={row.lead_time_days} enabled={row.alerts_enabled} />;
}

function AlertForm({ itemId, leadTime, enabled }: { itemId: InventoryItemId; leadTime: number; enabled: boolean }) {
  const change = useChangeItemAlerts(itemId);
  const toast = useToast();
  const [days, setDays] = useState(String(leadTime));
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string>();

  const save = () => {
    const value = Number(days);
    if (days.trim() === "" || !Number.isInteger(value) || value < 0 || value > 120) {
      setError("Enter a whole number of days, from 0 to 120.");
      return;
    }
    setError(undefined);
    change.mutate(
      { lead_time_days: value, alerts_enabled: on },
      {
        onSuccess: () => {
          toast.show({ title: "Alert settings saved", tone: "success" });
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't save these settings. Please try again.");
        },
      },
    );
  };

  return (
    <form
      aria-label="Alert settings"
      noValidate
      className="st2-settings"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <h3 className="text-sm font-bold text-text">Stock alerts</h3>
      <Switch label="Alert me about this item" hint="You'll hear when it is low or about to run out." checked={on} onCheckedChange={setOn} />
      <Field label="Delivery lead time (days)" hint="How long a reorder takes to arrive. Alerts start this many days, plus three, before it runs out.">
        <TextInput
          inputMode="numeric"
          value={days}
          onChange={(event) => {
            setDays(event.currentTarget.value);
          }}
        />
      </Field>
      {error === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={change.isPending}>
          {change.isPending ? "Saving…" : "Save alert settings"}
        </Button>
      </div>
    </form>
  );
}
