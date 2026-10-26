import { apiErrorOf, type OnlineBookingChanges } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { useState } from "react";

import { Field, Select, TextInput, useToast } from "@sakalya/ui";

import { MkCard, Toggle } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useClinicSettings, useUpdateClinicSettings } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

/** Settings, "Booking & notifications": online booking (owner only) beside the patient-message switches. */
export function BookingPanel() {
  const { can } = useClinic();
  return (
    <div className="st-two">
      {can("settings.manage") ? (
        <OnlineBookingCard />
      ) : (
        <MkCard title="Online booking" hint="Patients book from your clinic's /book page">
          <p className="mk-hint">Only the clinic owner can change online booking.</p>
        </MkCard>
      )}
      <NotificationsCard />
    </div>
  );
}

/** Not wired yet: the switches connect when Messages and Stock ship. */
function NotificationsCard() {
  return (
    <MkCard title="Notifications" hint="Quiet hours 9 PM – 9 AM IST">
      {[
        ["Appointment reminders", "24h + 2h before · WhatsApp"],
        ["Payment receipts", "Auto-send on collection"],
        ["Recall campaigns", "Promotional · needs opt-in"],
        ["Low-stock alerts", "Notify front desk + owner"],
      ].map(([title, text]) => (
        <div key={title} className="mk-setrow">
          <div>
            <b>{title}</b>
            <p>{text}</p>
          </div>
          <Toggle checked={false} disabled label={`${title ?? ""} (not available yet)`} />
        </div>
      ))}
      <p className="mk-hint" style={{ margin: "8px 0 0" }}>
        These switches connect when Messages and Stock ship.
      </p>
    </MkCard>
  );
}

/** Online booking: on or off, who confirms, and how long a visit slot is. The page itself is `/book`. */
function OnlineBookingCard() {
  const settings = useClinicSettings();
  const update = useUpdateClinicSettings();
  const toast = useToast();
  const booking = settings.data?.online_booking;
  const save = (changes: OnlineBookingChanges) => {
    update.mutate(
      { online_booking: changes },
      {
        onSuccess: () => {
          toast.show({ title: "Online booking updated", tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.", tone: "danger" });
        },
      },
    );
  };
  return (
    <MkCard title="Online booking" hint="Patients book from your clinic's /book page">
      {booking === undefined ? (
        settings.isError ? (
          <ApiErrorNotice title="Couldn't load online booking" error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <SkeletonRows count={3} label="Loading online booking" />
        )
      ) : (
        <>
          <div className="mk-setrow">
            <div>
              <b>Accept online bookings</b>
              <p>Patients pick a free time and verify their email</p>
            </div>
            <Toggle
              checked={booking.enabled}
              disabled={update.isPending}
              label="Accept online bookings"
              onChange={(next) => {
                save({ enabled: next });
              }}
            />
          </div>
          <div className="mk-setrow">
            <div>
              <b>Confirm bookings automatically</b>
              <p>{booking.auto_confirm ? "Bookings are confirmed at once" : "The front desk confirms each request"}</p>
            </div>
            <Toggle
              checked={booking.auto_confirm}
              disabled={update.isPending}
              label="Confirm bookings automatically"
              onChange={(next) => {
                save({ auto_confirm: next });
              }}
            />
          </div>
          <div className="mk-setrow">
            <div>
              <b>Mark no-shows automatically</b>
              <p>{booking.no_show_auto ? "Missed visits are marked once the grace has passed" : "Staff mark missed visits by hand"}</p>
            </div>
            <Toggle
              checked={booking.no_show_auto}
              disabled={update.isPending}
              label="Mark no-shows automatically"
              onChange={(next) => {
                save({ no_show_auto: next });
              }}
            />
          </div>
          <GraceField key={booking.no_show_grace_minutes} value={booking.no_show_grace_minutes} disabled={update.isPending} onSave={(minutes) => { save({ no_show_grace_minutes: minutes }); }} />
          <Field label="Visit length">
            <Select
              options={[10, 15, 20, 30, 45, 60].map((minutes) => ({ value: String(minutes), label: `${String(minutes)} minutes` }))}
              value={String(booking.slot_minutes)}
              onValueChange={(value) => {
                save({ slot_minutes: Number(value) });
              }}
            />
          </Field>
        </>
      )}
    </MkCard>
  );
}

/** Minutes after the slot before a missed visit is marked, 0 to 240; saved when the field is left. */
function GraceField({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (minutes: number) => void }) {
  const [text, setText] = useState(String(value));
  const minutes = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(minutes) && minutes >= 0 && minutes <= 240;
  return (
    <Field label="Grace after the slot (minutes)" hint="0 to 240" {...(valid ? {} : { error: "Enter a whole number from 0 to 240" })}>
      <TextInput
        type="number"
        inputMode="numeric"
        min={0}
        max={240}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => {
          if (valid && minutes !== value) onSave(minutes);
        }}
      />
    </Field>
  );
}
