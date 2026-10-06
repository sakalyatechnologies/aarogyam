import { ClipboardList, Copy, ExternalLink, Globe, MailPlus, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import { clinicId as clinicIdSchema, apiErrorOf, type ClinicId, type ClinicInvited, type ResentOwnerInvitation } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber, useDocumentTitle } from "@aarogyam/app-kit";
import { Avatar, Button, Card, DataTable, Dialog, EmptyState, Field, PageHeader, Select, Skeleton, TextInput, useToast, type DataTableColumn, type Tone } from "@sakalya/ui";

import { useClinicDetail, useInviteToClinic, useResendOwnerInvitation } from "../../api.js";
import { StatusChip } from "../../ui/status-chip.js";
import { Tile } from "../../ui/tile.js";
import { ADDRESS_STATUS, AddressStatusPill } from "./address-status.js";
import { ClinicStatusPill } from "./clinic-status.js";
import { STATUS_MEANING, expiryNote } from "./clinics-view.js";

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
  const [resendOpen, setResendOpen] = useState(false);

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

  const now = new Date();
  const memberTone = (status: string): Tone => (status === "active" ? "success" : status === "suspended" ? "warning" : status === "invited" ? "info" : "neutral");
  const memberLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

  const memberColumns: readonly DataTableColumn<(typeof clinic.members)[number]>[] = [
    {
      id: "name",
      header: "Name",
      cell: (m) => (
        <span className="flex items-center gap-3">
          <Avatar name={m.display_name} size="sm" />
          <span className="flex flex-col">
            <span className="font-semibold">{m.display_name}</span>
            <span className="font-mono text-xs text-muted">{m.email ?? "—"}</span>
          </span>
        </span>
      ),
      sortValue: (m) => m.display_name,
    },
    { id: "role", header: "Role", cell: (m) => m.role_name, sortValue: (m) => m.role_name },
    {
      id: "status",
      header: "Status",
      cell: (m) => <StatusChip tone={memberTone(m.status)}>{memberLabel(m.status)}</StatusChip>,
      sortValue: (m) => m.status,
    },
    { id: "joined", header: "Joined", align: "end", cell: (m) => (m.joined_at == null ? "—" : formatDate(m.joined_at)), sortValue: (m) => m.joined_at ?? "" },
  ];

  const invitationColumns: readonly DataTableColumn<(typeof clinic.invitations)[number]>[] = [
    { id: "email", header: "Email", cell: (i) => <span className="font-mono text-xs">{i.email ?? "—"}</span> },
    { id: "role", header: "Role", cell: (i) => i.role_name },
    { id: "sent", header: "Sent", align: "end", cell: (i) => formatDate(i.created_at), sortValue: (i) => i.created_at },
    {
      id: "expires",
      header: "Expires",
      align: "end",
      cell: (i) => {
        const note = expiryNote(i.expires_at, now);
        return <StatusChip tone={note.expired ? "danger" : "warning"}>{note.text}</StatusChip>;
      },
      sortValue: (i) => i.expires_at,
    },
  ];

  return (
    <>
      <PageHeader
        title={clinic.name}
        subtitle={clinic.hosts[0] ?? clinic.slug}
        end={
          <div className="flex flex-wrap gap-2">
            {clinic.members.some((m) => m.role_key === "owner" && m.status === "active") ? null : (
              <Button
                variant="secondary"
                icon={<MailPlus aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setResendOpen(true);
                }}
              >
                Resend invitation
              </Button>
            )}
            <Button
              icon={<UserPlus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setInviteOpen(true);
              }}
            >
              Invite doctor or staff
            </Button>
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Tile label="Status" value={<ClinicStatusPill status={clinic.status} />} tone="info" note={clinic.specialty === "dental" ? "Dental" : clinic.specialty} />
        <Tile label="Active staff" value={formatNumber(clinic.active_members)} />
        <Tile label="Patients" value={formatNumber(clinic.patients)} />
        <Tile label="Pending invitations" value={formatNumber(clinic.pending_invitations)} tone={clinic.pending_invitations > 0 ? "warning" : "neutral"} />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Plan and status">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="col-span-2 flex flex-col gap-1">
              <dt className="text-xs font-semibold text-muted">Status</dt>
              <dd className="flex flex-col items-start gap-1.5">
                <ClinicStatusPill status={clinic.status} />
                <span className="text-muted">{STATUS_MEANING[clinic.status]}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">Specialty</dt>
              <dd>{clinic.specialty === "dental" ? "Dental" : clinic.specialty}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">Time zone</dt>
              <dd>{clinic.timezone}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">Created</dt>
              <dd>{formatDate(clinic.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">Billing plan</dt>
              <dd className="text-muted">Not tracked yet</dd>
            </div>
          </dl>
        </Card>
        <Card title="Addresses" action={<Globe aria-hidden="true" className="size-5 text-muted" />}>
          {clinic.hosts.length === 0 ? (
            <EmptyState title="No address yet" description="The clinic gets its portal address when it is created." />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Clinic addresses">
              {clinic.hosts.map((host, index) => (
                <li key={host} className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2">
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <span className="font-mono text-xs break-all">{host}</span>
                    {index === 0 && clinic.address_status != null ? (
                      <>
                        <AddressStatusPill status={clinic.address_status} />
                        <span className="text-xs text-muted">{ADDRESS_STATUS[clinic.address_status].meaning}</span>
                        {clinic.address_status !== "ready" && clinic.address_error != null ? (
                          <span className="text-xs text-danger-text">Last attempt: {clinic.address_error}</span>
                        ) : null}
                      </>
                    ) : null}
                  </span>
                  <a
                    href={`https://${host}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    Open <span className="sr-only">{host} in a new tab</span>
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title={`Staff (${String(clinic.members.length)})`}>
          <DataTable
            caption="Staff"
            columns={memberColumns}
            rows={clinic.members}
            rowKey={(m) => m.membership_id}
            empty={{ title: "No staff yet", description: "Invite the owner to get started.", icon: <UsersRound className="size-7" /> }}
          />
        </Card>
        <Card title={`Pending invitations (${String(clinic.pending_invitations)})`}>
          <DataTable
            caption="Pending invitations"
            columns={invitationColumns}
            rows={clinic.invitations}
            rowKey={(i) => i.id}
            empty={{ title: "No pending invitations", description: "Invitations show here until they are accepted or expire.", icon: <ClipboardList className="size-7" /> }}
          />
        </Card>
      </div>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} clinicId={id} />
      <ResendDialog open={resendOpen} onOpenChange={setResendOpen} clinicId={id} />
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

function ResendDialog({ open, onOpenChange, clinicId: id }: { open: boolean; onOpenChange: (open: boolean) => void; clinicId: ClinicId }) {
  const resend = useResendOwnerInvitation(id);
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<ResentOwnerInvitation>();

  const close = () => {
    onOpenChange(false);
    setError(undefined);
    setSent(undefined);
  };

  const submit = () => {
    setError(undefined);
    resend.mutate(undefined, {
      onSuccess: setSent,
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't send the invitation. Please try again.");
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={sent === undefined ? "Resend the owner's invitation" : "Invitation sent"}
      description={
        sent === undefined
          ? "The owner gets a new email with a new link. The link sent before stops working."
          : `It was also emailed to ${sent.email}. The earlier link no longer works.`
      }
      dismissOnOutsidePress={sent === undefined}
      footer={
        sent === undefined ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={resend.isPending}>
              {resend.isPending ? "Sending…" : "Resend invitation"}
            </Button>
          </>
        ) : (
          <Button
            icon={<Copy aria-hidden="true" className="size-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(sent.invite_link).then(
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
      {sent === undefined ? (
        error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )
      ) : (
        <Field label="Invitation link">
          <TextInput readOnly value={sent.invite_link} className="font-mono" onFocus={(event) => { event.currentTarget.select(); }} />
        </Field>
      )}
    </Dialog>
  );
}
