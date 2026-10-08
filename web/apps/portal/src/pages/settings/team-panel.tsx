import { Mail, MoreVertical, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { apiErrorOf, type MemberChanges, type MembershipId, type Role } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";
import { Avatar, Button, Card, DataTable, Dialog, Field, Menu, Pill, Select, TextInput, useToast, type DataTableColumn, type MenuItem } from "@sakalya/ui";

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
                  {invitation.email ?? "Invited"}
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
