import { Building2, ClipboardList, Copy, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import { clinicId as clinicIdSchema, apiErrorOf, type ClinicId, type ClinicInvited } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber, useDocumentTitle } from "@aarogyam/app-kit";
import { Avatar, Button, Card, DataTable, Dialog, Field, PageHeader, Pill, Select, Skeleton, StatCard, TextInput, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinicDetail, useInviteToClinic } from "../../api.js";
import { ClinicStatusPill } from "./clinic-status.js";

const ROLE_OPTIONS = [
  { value: "doctor", label: "Doctor" },
  { value: "front_desk", label: "Front desk" },
  { value: "assistant", label: "Assistant" },
  { value: "finance", label: "Finance" },
  { value: "owner", label: "Owner" },
];

export function ClinicDetailPage() {
  const params = useParams();
  const parsed = clinicIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const detail = useClinicDetail(id);
  const [inviteOpen, setInviteOpen] = useState(false);

  useDocumentTitle(detail.data?.name ?? "Clinic", "Sakalya Console");

  if (id === undefined) {
    return <ApiErrorNotice title="That clinic address isn't valid" error={{ status: 404, code: "not_found", message: "No such clinic." }} />;
  }
  if (detail.isPending) {
    return (
      <div className="p-6" role="status" aria-label="Loading the clinic">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (detail.isError) {
    return <ApiErrorNotice title="Couldn't load this clinic" error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  const clinic = detail.data;

  const memberColumns: readonly DataTableColumn<(typeof clinic.members)[number]>[] = [
    {
      id: "name",
      header: "Name",
      cell: (m) => (
        <span className="flex items-center gap-3">
          <Avatar name={m.display_name} size="sm" />
          <span className="font-semibold">{m.display_name}</span>
        </span>
      ),
    },
    { id: "email", header: "Email", cell: (m) => <span className="font-mono text-xs">{m.email ?? "—"}</span> },
    { id: "role", header: "Role", cell: (m) => m.role_name },
    {
      id: "status",
      header: "Status",
      cell: (m) => <Pill tone={m.status === "active" ? "success" : m.status === "suspended" ? "warning" : "neutral"}>{m.status}</Pill>,
    },
    { id: "joined", header: "Joined", align: "end", cell: (m) => (m.joined_at == null ? "—" : formatDate(m.joined_at)) },
  ];

  const invitationColumns: readonly DataTableColumn<(typeof clinic.invitations)[number]>[] = [
    { id: "email", header: "Email", cell: (i) => <span className="font-mono text-xs">{i.email ?? "—"}</span> },
    { id: "role", header: "Role", cell: (i) => i.role_name },
    { id: "expires", header: "Expires", align: "end", cell: (i) => formatDate(i.expires_at) },
  ];

  return (
    <>
      <PageHeader
        title={clinic.name}
        subtitle={clinic.hosts[0] ?? clinic.slug}
        end={
          <Button
            icon={<UserPlus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setInviteOpen(true);
            }}
          >
            Invite doctor or staff
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Specialty"
          value={clinic.specialty === "dental" ? "Dental" : clinic.specialty}
          icon={<Building2 className="size-7" />}
          footer={<ClinicStatusPill status={clinic.status} />}
        />
        <StatCard label="Active staff" value={formatNumber(clinic.active_members)} icon={<UsersRound className="size-7" />} />
        <StatCard label="Patients" value={formatNumber(clinic.patients)} icon={<ClipboardList className="size-7" />} />
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Staff">
          <DataTable caption="Staff" columns={memberColumns} rows={clinic.members} rowKey={(m) => m.membership_id} />
        </Card>
        {clinic.invitations.length === 0 ? null : (
          <Card title={`Pending invitations (${String(clinic.pending_invitations)})`}>
            <DataTable caption="Pending invitations" columns={invitationColumns} rows={clinic.invitations} rowKey={(i) => i.id} />
          </Card>
        )}
      </div>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} clinicId={id} />
    </>
  );
}

function InviteDialog({ open, onOpenChange, clinicId: id }: { open: boolean; onOpenChange: (open: boolean) => void; clinicId: ClinicId }) {
  const invite = useInviteToClinic(id);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("doctor");
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<ClinicInvited>();

  const close = () => {
    onOpenChange(false);
    setEmail("");
    setRoleKey("doctor");
    setError(undefined);
    setCreated(undefined);
  };

  const submit = () => {
    setError(undefined);
    invite.mutate(
      { email, role_key: roleKey },
      {
        onSuccess: setCreated,
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't send the invitation. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={created === undefined ? "Invite doctor or staff" : "Invitation sent"}
      description={created === undefined ? "They'll get an email with a link to join this clinic." : `It was also emailed to ${created.email}.`}
      dismissOnOutsidePress={created === undefined}
      footer={
        created === undefined ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={invite.isPending || email === ""}>
              {invite.isPending ? "Sending…" : "Send invite"}
            </Button>
          </>
        ) : (
          <Button
            icon={<Copy aria-hidden="true" className="size-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(created.invite_link).then(
                () => toast.show({ title: "Invitation link copied", tone: "success" }),
                () => toast.show({ title: "Couldn't copy; select the link and copy it", tone: "warning" }),
              );
            }}
          >
            Copy link
          </Button>
        )
      }
    >
      {created === undefined ? (
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
            <Select options={ROLE_OPTIONS} value={roleKey} onValueChange={setRoleKey} />
          </Field>
          {error === undefined ? null : (
            <p role="alert" className="text-sm font-medium text-danger-text">
              {error}
            </p>
          )}
        </div>
      ) : (
        <Field label="Invitation link">
          <TextInput readOnly value={created.invite_link} className="font-mono" onFocus={(event) => { event.currentTarget.select(); }} />
        </Field>
      )}
    </Dialog>
  );
}
