import { Mail, MoreVertical, UserPlus } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { apiErrorOf, type ClinicSettings, type MemberChanges, type MembershipId, type OnlineBookingChanges, type Role } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, useDocumentTitle } from "@aarogyam/app-kit";
import {
  Avatar,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Menu,
  Pill,
  Select,
  Skeleton,
  Tabs,
  TextInput,
  useToast,
  type DataTableColumn,
  type MenuItem,
  type TabItem,
} from "@sakalya/ui";

import { MkCard, Toggle } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import {
  useChangeStaffMember,
  useClinicSettings,
  useInviteStaff,
  useMySessions,
  useRevokeSession,
  useRoles,
  useStaff,
  useUpdateClinicSettings,
} from "../../queries.js";
import { ChairsDoctorsPanel } from "./chairs-doctors-panel.js";
import { PriceListPanel } from "./price-list-panel.js";

/** Clinic profile, notifications and website cards in the mock-up's layout, then the admin panels. */
export function SettingsPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Settings", session.clinic.name);
  const items: TabItem[] = [
    ...(can("settings.manage") ? [{ value: "chairs-doctors", label: "Chairs and doctors", content: <ChairsDoctorsPanel /> }] : []),
    ...(can("billing.read") ? [{ value: "price-list", label: "Price list", content: <PriceListPanel /> }] : []),
    ...(can("staff.manage") ? [{ value: "staff", label: "Staff", content: <StaffPanel /> }] : []),
    { value: "sessions", label: "Sessions", content: <SessionsPanel /> },
  ];
  return (
    <div className="mk-panel">
      <h1 className="mk-sr">Settings</h1>
      <div className="mk-grid mk-g2">
        {can("settings.manage") ? (
          <MkCard title="Clinic profile" hint="Shown on website, bills & prescriptions">
            <ProfilePanel />
          </MkCard>
        ) : (
          <MkCard title="Your account" hint="Signed in as">
            <p className="mk-empty">
              <b>{session.user.display_name}</b>
              Only the clinic owner can change the clinic profile.
            </p>
          </MkCard>
        )}
        <div className="mk-stack">
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
          {can("settings.manage") ? (
            <OnlineBookingCard />
          ) : (
            <MkCard title="Online booking" hint="Patients book from your clinic's /book page">
              <p className="mk-hint">Only the clinic owner can change online booking.</p>
            </MkCard>
          )}
        </div>
      </div>
      <MkCard title="Clinic administration" hint="Chairs, doctors, prices, staff and your signed-in devices">
        <Tabs label="Settings" items={items} />
      </MkCard>
    </div>
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
          <Skeleton shape="block" />
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

function ProfilePanel() {
  const settings = useClinicSettings();
  if (settings.isPending) {
    return <Skeleton shape="block" />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load the clinic's settings" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  return <ProfileForm settings={settings.data} />;
}

interface ProfileValues {
  name: string;
  legal_name: string;
  gstin: string;
  phone: string;
  upi_id: string;
  prescription_footer: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

function toValues(settings: ClinicSettings): ProfileValues {
  return {
    name: settings.name,
    legal_name: settings.legal_name ?? "",
    gstin: settings.gstin ?? "",
    phone: settings.phone ?? "",
    upi_id: settings.upi_id ?? "",
    prescription_footer: settings.prescription_footer ?? "",
    line1: settings.address.line1 ?? "",
    line2: settings.address.line2 ?? "",
    city: settings.address.city ?? "",
    state: settings.address.state ?? "",
    pincode: settings.address.pincode ?? "",
  };
}

function ProfileForm({ settings }: { settings: ClinicSettings }) {
  const update = useUpdateClinicSettings();
  const toast = useToast();
  const [form, setForm] = useState<ProfileValues>(() => toValues(settings));
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ProfileValues, string>>>({});

  const field = (key: keyof ProfileValues) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => {
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
    },
  });

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setFieldErrors({});
    update.mutate(
      {
        name: form.name,
        legal_name: form.legal_name,
        gstin: form.gstin,
        phone: form.phone,
        upi_id: form.upi_id,
        prescription_footer: form.prescription_footer,
        address: { line1: form.line1, line2: form.line2, city: form.city, state: form.state, pincode: form.pincode },
      },
      {
        onSuccess: (saved) => {
          setForm(toValues(saved));
          toast.show({ title: "Settings saved", tone: "success" });
        },
        onError: (thrown) => {
          const apiError = apiErrorOf(thrown);
          const key = apiError?.field;
          if (apiError !== undefined && key !== undefined && isProfileField(key)) {
            setFieldErrors({ [key]: apiError.message });
          } else {
            setError(apiError?.message ?? "Couldn't save the clinic's settings. Please try again.");
          }
        },
      },
    );
  };

  const input = (key: keyof ProfileValues, label: string, extra: { className?: string; placeholder?: string } = {}) => (
    <>
      <label className="mk-flabel" htmlFor={`profile-${key}`}>
        {label}
      </label>
      <input id={`profile-${key}`} className={`mk-tin ${extra.className ?? ""}`} placeholder={extra.placeholder} aria-invalid={fieldErrors[key] !== undefined} {...field(key)} />
      {fieldErrors[key] === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: "4px 0 0" }}>
          {fieldErrors[key]}
        </p>
      )}
    </>
  );
  return (
    <form onSubmit={onSubmit} style={{ marginTop: -8 }}>
      {input("name", "Clinic name")}
      {input("legal_name", "Legal name")}
      {input("line1", "Address", { placeholder: "House, building and street" })}
      <input className="mk-tin" style={{ marginTop: 8 }} aria-label="Address line 2" placeholder="Area or landmark" {...field("line2")} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
        <input className="mk-tin" placeholder="City" aria-label="City" {...field("city")} />
        <input className="mk-tin" placeholder="State" aria-label="State" {...field("state")} />
        <input className="mk-tin" placeholder="PIN code" aria-label="PIN code" {...field("pincode")} />
      </div>
      {input("phone", "Phone")}
      {input("upi_id", "UPI ID", { placeholder: "clinic@okicici" })}
      {input("gstin", "GSTIN", { className: "mk-mono" })}
      <label className="mk-flabel" htmlFor="profile-footer">
        Prescription footer
      </label>
      <textarea id="profile-footer" className="mk-tin" rows={2} {...field("prescription_footer")} />
      {fieldErrors.prescription_footer === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: "4px 0 0" }}>
          {fieldErrors.prescription_footer}
        </p>
      )}
      {error === undefined ? null : (
        <p role="alert" className="mk-pill down" style={{ display: "block", marginTop: 12, borderRadius: 12, padding: "10px 14px" }}>
          {error}
        </p>
      )}
      <button type="submit" className="mk-btn mk-btn-primary" style={{ marginTop: 16 }} disabled={update.isPending}>
        {update.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function isProfileField(key: string): key is keyof ProfileValues {
  return key in { name: 0, legal_name: 0, gstin: 0, phone: 0, upi_id: 0, prescription_footer: 0, line1: 0, line2: 0, city: 0, state: 0, pincode: 0 };
}

function StaffPanel() {
  const staff = useStaff();
  const roles = useRoles();
  const { session } = useClinic();
  const [inviteOpen, setInviteOpen] = useState(false);

  if (staff.isPending) {
    return <Skeleton shape="block" />;
  }
  if (staff.isError) {
    return <ApiErrorNotice title="Couldn't load the staff list" error={staff.error} onRetry={() => void staff.refetch()} />;
  }

  const columns: readonly DataTableColumn<(typeof staff.data.members)[number]>[] = [
    {
      id: "name",
      header: "Name",
      cell: (member) => (
        <span className="flex items-center gap-3">
          <Avatar name={member.display_name} size="sm" />
          <span className="font-semibold text-text">{member.display_name}</span>
        </span>
      ),
    },
    { id: "role", header: "Role", cell: (member) => member.role_name },
    {
      id: "status",
      header: "Status",
      cell: (member) => (
        <Pill tone={member.status === "active" ? "success" : member.status === "suspended" ? "warning" : "neutral"}>{member.status}</Pill>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      cell: (member) => <MemberMenu member={member} selfId={session.membership.id} />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          icon={<UserPlus aria-hidden="true" className="size-4" />}
          onClick={() => {
            setInviteOpen(true);
          }}
        >
          Invite
        </Button>
      </div>
      <DataTable caption="Staff" columns={columns} rows={staff.data.members} rowKey={(member) => member.id} />
      {staff.data.invitations.length > 0 ? (
        <Card title="Pending invitations">
          <ul className="divide-y divide-border">
            {staff.data.invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex items-center gap-2 font-semibold text-text">
                  <Mail aria-hidden="true" className="size-4 text-muted" />
                  {invitation.email ?? "Invited"}
                </span>
                <span className="text-muted">
                  {invitation.role_key} · expires {formatDate(invitation.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={roles.data?.items ?? []} />
    </div>
  );
}

function MemberMenu({ member, selfId }: { member: { id: MembershipId; display_name: string; status: string }; selfId: MembershipId }) {
  const change = useChangeStaffMember();
  const toast = useToast();
  if (member.id === selfId) {
    return null;
  }
  const items: MenuItem[] = [];
  if (member.status === "active") {
    items.push({ id: "suspend", label: "Suspend" });
  } else if (member.status === "suspended") {
    items.push({ id: "reactivate", label: "Reactivate" });
  }
  if (member.status !== "left") {
    items.push({ id: "remove", label: "Remove", danger: true, separatorBefore: true });
  }
  if (items.length === 0) {
    return null;
  }
  const onSelect = (id: string) => {
    const changes: MemberChanges = id === "suspend" ? { status: "suspended" } : id === "reactivate" ? { status: "active" } : { status: "left" };
    change.mutate(
      { id: member.id, changes },
      {
        onSuccess: () => {
          toast.show({ title: `Updated ${member.display_name}`, tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update that member.", tone: "danger" });
        },
      },
    );
  };
  return <Menu label={`Actions for ${member.display_name}`} icon={<MoreVertical aria-hidden="true" className="size-4" />} items={items} onSelect={onSelect} />;
}

function InviteDialog({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (open: boolean) => void; roles: readonly Role[] }) {
  const invite = useInviteStaff();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const close = () => {
    onOpenChange(false);
    setEmail("");
    setRoleKey("");
    setError(undefined);
  };

  const submit = () => {
    invite.mutate(
      { email, role_key: roleKey },
      {
        onSuccess: (created) => {
          toast.show({ title: `Invited ${created.email}`, tone: "success" });
          close();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't send the invitation. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite someone"
      description="They'll get an email with a link to join."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={invite.isPending || email === "" || roleKey === ""}>
            {invite.isPending ? "Sending…" : "Send invite"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Email" required>
          <TextInput
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>
        <Field label="Role" required>
          <Select
            options={roles.map((role) => ({ value: role.key, label: role.name }))}
            value={roleKey}
            onValueChange={setRoleKey}
            placeholder="Choose a role"
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function SessionsPanel() {
  const sessions = useMySessions();
  const revoke = useRevokeSession();
  const toast = useToast();
  if (sessions.isPending) {
    return <Skeleton shape="block" />;
  }
  if (sessions.isError) {
    return <ApiErrorNotice title="Couldn't load your sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />;
  }
  return (
    <ul className="divide-y divide-border">
      {sessions.data.items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-text">
              {item.current ? "This device" : "Another device"}
              {item.current ? <Pill tone="success">Current</Pill> : null}
            </p>
            <p className="text-xs text-muted">
              Last active {formatDateTime(item.last_active_at)} · Signed in {formatDate(item.created_at)}
            </p>
          </div>
          {item.current ? null : (
            <Button
              variant="secondary"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(item.id, {
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't sign that device out.", tone: "danger" });
                  },
                });
              }}
            >
              End this session
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
