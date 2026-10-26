import { apiErrorOf, type ConflictPolicyValue, type OnlineBookingChanges, type PractitionerId } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Field, Select, useToast } from "@sakalya/ui";

import { MkCard, Toggle } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useClinicSettings, useConflictPolicy, usePractitioners, useSetConflictPolicy, useUpdateClinicSettings } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

/** Settings, "Booking & notifications": online booking (owner only) beside the patient-message switches. */
export function BookingPanel() {
  const { can, session } = useClinic();
  return (
    <div className="st-two">
      {can("settings.manage") ? (
        <OnlineBookingCard />
      ) : can("clinical.write") ? (
        <MkCard title="Online booking" hint="Patients book from your clinic's /book page">
          <p className="mk-hint">Only the clinic owner can change online booking.</p>
          <DoctorPolicies ownMembershipId={session.membership.id} />
        </MkCard>
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
          <Field label="When a time is already booked" hint="What a patient asking online for a taken time gets.">
            <Select
              options={CLINIC_POLICY_OPTIONS}
              value={booking.conflict_policy === "strict" ? "strict" : "request"}
              onValueChange={(value) => {
                save({ conflict_policy: value });
              }}
            />
          </Field>
          <DoctorPolicies ownMembershipId={undefined} />
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

const CLINIC_POLICY_OPTIONS = [
  { value: "request", label: "Ask the desk" },
  { value: "strict", label: "Don't allow" },
];
const DOCTOR_POLICY_OPTIONS = [{ value: "default", label: "Clinic default" }, ...CLINIC_POLICY_OPTIONS];

/** Each doctor's own answer to a taken time. The owner sees every doctor; a doctor only their own row. */
function DoctorPolicies({ ownMembershipId }: { ownMembershipId: string | undefined }) {
  const doctors = usePractitioners();
  const rows = (doctors.data?.items ?? []).filter((p) => p.active && (ownMembershipId === undefined || p.membership_id === ownMembershipId));
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Each doctor's answer to a taken time">
      <p className="mk-hint" style={{ margin: 0 }}>{ownMembershipId === undefined ? "Per doctor" : "When a time is already booked"}</p>
      {rows.map((doctor) => (
        <DoctorPolicyRow key={doctor.id} id={doctor.id} name={doctor.display_name} />
      ))}
    </div>
  );
}

function DoctorPolicyRow({ id, name }: { id: PractitionerId; name: string }) {
  const policy = useConflictPolicy(id);
  const set = useSetConflictPolicy();
  const toast = useToast();
  return (
    <Field label={name}>
      <Select
        options={DOCTOR_POLICY_OPTIONS}
        value={policy.data?.conflict_policy ?? "default"}
        disabled={policy.data === undefined || set.isPending}
        onValueChange={(value) => {
          const next: ConflictPolicyValue | null = value === "request" || value === "strict" ? value : null;
          set.mutate(
            { id, policy: { conflict_policy: next } },
            {
              onSuccess: () => { toast.show({ title: `${name}: saved`, tone: "success" }); },
              onError: (thrown) => { toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.", tone: "danger" }); },
            },
          );
        }}
      />
    </Field>
  );
}
