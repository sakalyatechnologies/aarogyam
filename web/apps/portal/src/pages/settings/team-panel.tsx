import { Mail, MoreVertical, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { apiErrorOf, type MemberChanges, type MembershipId, type Role } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";
import { Avatar, Button, Card, DataTable, Dialog, Field, Menu, PhoneInput, Pill, Select, TextInput, useToast, type DataTableColumn, type MenuItem } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useChangeStaffMember, useInviteStaff, useRoles, useStaff } from "../../queries.js";
import { RolesPanel } from "./roles-panel.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

/** Settings, "Team & roles": the staff list for staff.manage, the roles editor for roles.manage. */
export function TeamPanel() {
  const { can } = useClinic();
  return (
    <div className="flex flex-col gap-6">
      {can("staff.manage") ? <StaffPanel /> : null}
      {can("roles.manage") ? <RolesPanel /> : null}
    </div>
  );
}

function StaffPanel() {
  const staff = useStaff();
  const roles = useRoles();
  const { session, can } = useClinic();
  const [inviteOpen, setInviteOpen] = useState(false);

  if (staff.isPending) {
    return <SkeletonRows count={5} label="Loading staff" />;
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
    {
      id: "role",
      header: "Role",
      cell: (member) =>
        can("roles.manage") ? (
          <Link to={`/settings?tab=team&role=${encodeURIComponent(member.role_key)}`} className="mk-link" title={`See what ${member.role_name} can do`}>
            {member.role_name}
          </Link>
        ) : (
          member.role_name
        ),
    },
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
                  {invitation.display_name ?? invitation.email ?? "Invited"}
                  {invitation.display_name != null && invitation.email != null ? <span className="font-normal text-muted">{invitation.email}</span> : null}
                </span>
                <span className="text-muted">
                  {roles.data?.items.find((role) => role.key === invitation.role_key)?.name ?? invitation.role_key} · expires {formatDate(invitation.expires_at)}
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What's wrong with each invite field, or nothing. `phone` is the 10 national digits (`+91` is fixed). */
export function inviteProblems(values: { name: string; phone: string; email: string; roleKey: string }) {
  const name = values.name.trim();
  return {
    name: name.length < 2 ? "Enter their full name." : name.length > 200 ? "Keep the name under 200 characters." : undefined,
    phone: /^[6-9]\d{9}$/.test(values.phone) ? undefined : "Enter a 10-digit mobile number.",
    email: EMAIL.test(values.email.trim()) ? undefined : "Enter an email address, such as name@example.com.",
    roleKey: values.roleKey === "" ? "Choose a role." : undefined,
  };
}

/** The join link for a fresh invitation. The token rides in the fragment, which browsers never send to a server. */
function joinLink(token: string): string {
  return `${window.location.origin}/invite#${token}`;
}

type InviteField = "name" | "phone" | "email" | "roleKey";

function InviteDialog({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (open: boolean) => void; roles: readonly Role[] }) {
  const invite = useInviteStaff();
  const [values, setValues] = useState({ name: "", phone: "", email: "", roleKey: "" });
  const [left, setLeft] = useState<ReadonlySet<InviteField>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState<{ link: string; phone: string; email: string; name: string } | undefined>(undefined);
  const problems = inviteProblems(values);
  const valid = Object.values(problems).every((problem) => problem === undefined);
  // A field's problem shows once the person has left it, so typing isn't interrupted.
  const shown = (field: InviteField) => (left.has(field) ? problems[field] : undefined);
  const leave = (field: InviteField) => () => {
    setLeft((was) => new Set(was).add(field));
  };
  const set = (field: InviteField) => (value: string) => {
    setValues((was) => ({ ...was, [field]: value }));
  };

  const close = () => {
    onOpenChange(false);
    setValues({ name: "", phone: "", email: "", roleKey: "" });
    setLeft(new Set());
    setError(undefined);
    setSent(undefined);
  };

  const submit = () => {
    if (!valid) {
      setLeft(new Set<InviteField>(["name", "phone", "email", "roleKey"]));
      return;
    }
    const phone = `+91${values.phone}`;
    invite.mutate(
      { email: values.email.trim(), role_key: values.roleKey, display_name: values.name.trim(), phone },
      {
        onSuccess: (created) => {
          setSent({ link: joinLink(created.invite_token), phone: phone.slice(1), email: created.email, name: values.name.trim() });
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't send the invitation. Please try again.");
        },
      },
    );
  };

  if (sent !== undefined) {
    const message = `Hi ${sent.name}, you're invited to join our clinic on Aarogyam. Open this link and sign in with ${sent.email}: ${sent.link}`;
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Invitation sent"
        description={`We emailed ${sent.email}. They open the link and sign in with a code we email them; no password needed.`}
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="flex flex-col gap-3">
          <TextInput readOnly aria-label="Invite link" value={sent.link} />
          <a className="mk-link text-sm font-semibold" href={`https://wa.me/${sent.phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            Also send on WhatsApp
          </a>
          <p className="text-xs text-muted">The link is shown only once.</p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite someone"
      description="We email them a link to join. They sign in with that email."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={invite.isPending || !valid}>
            {invite.isPending ? "Sending…" : "Send invite"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Full name" required error={shown("name")}>
          <TextInput autoComplete="off" value={values.name} maxLength={200} onChange={(event) => { set("name")(event.target.value); }} onBlur={leave("name")} />
        </Field>
        <Field label="Mobile" required error={shown("phone")}>
          <PhoneInput autoComplete="off" value={values.phone} onValueChange={set("phone")} onBlur={leave("phone")} />
        </Field>
        <Field label="Email" required hint="They sign in with this address." error={shown("email")}>
          <TextInput type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={values.email} onChange={(event) => { set("email")(event.target.value); }} onBlur={leave("email")} />
        </Field>
        <Field label="Role" required error={shown("roleKey")}>
          <Select
            options={roles.map((role) => ({ value: role.key, label: role.name }))}
            value={values.roleKey}
            onValueChange={(value) => {
              set("roleKey")(value);
              leave("roleKey")();
            }}
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
