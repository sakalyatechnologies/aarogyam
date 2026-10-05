import { Check, Copy, Inbox, Mail, MapPin, Phone, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { apiErrorOf, type Application } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, useDocumentTitle } from "@aarogyam/app-kit";
import {
  Button,
  Card,
  ChipFilterGroup,
  DataTable,
  Dialog,
  Drawer,
  Field,
  PageHeader,
  SearchInput,
  Select,
  TextArea,
  TextInput,
  useToast,
  type DataTableColumn,
  type Tone,
} from "@sakalya/ui";

import { useApplications, useApproveApplication, useRejectApplication } from "../../api.js";
import { StatusChip } from "../../ui/status-chip.js";
import { Tile } from "../../ui/tile.js";
import { slugify } from "../clinics/slug.js";
import {
  REJECT_REASONS,
  countByStatus,
  filterApplications,
  reasonProblem,
  type SpecialtyFilter,
  type StatusFilter,
} from "./applications-view.js";

const STATUS_TONE: Readonly<Record<string, Tone>> = { pending: "warning", approved: "success", rejected: "neutral" };
const STATUS_LABEL: Readonly<Record<string, string>> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

const SPECIALTIES = [
  { value: "all", label: "All specialties" },
  { value: "dental", label: "Dental" },
  { value: "general", label: "General practice" },
] as const;

const specialtyName = (value: string) => (value === "dental" ? "Dental" : value === "general" ? "General practice" : value);

function StatusOf({ status }: { status: string }) {
  return <StatusChip tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</StatusChip>;
}

export function ApplicationsPage() {
  useDocumentTitle("Applications", "Sakalya Console");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [specialty, setSpecialty] = useState<SpecialtyFilter>("all");
  const [query, setQuery] = useState("");
  const applications = useApplications();
  const [approving, setApproving] = useState<Application>();
  const [rejecting, setRejecting] = useState<Application>();
  const [viewing, setViewing] = useState<Application>();

  const items = applications.data?.items ?? [];
  const counts = countByStatus(items);
  const rows = filterApplications(items, { status, specialty, query });
  const filtered = status !== "all" || specialty !== "all" || query.trim() !== "";

  const columns: readonly DataTableColumn<Application>[] = [
    {
      id: "clinic",
      header: "Clinic",
      cell: (a) => (
        <span className="flex flex-col items-start">
          <button
            type="button"
            className="rounded text-left font-semibold text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => {
              setViewing(a);
            }}
          >
            {a.clinic_name}
          </button>
          <span className="text-xs text-muted">
            {a.city} · {specialtyName(a.specialty)}
          </span>
        </span>
      ),
      sortValue: (a) => a.clinic_name,
    },
    {
      id: "contact",
      header: "Contact",
      cell: (a) => (
        <span className="flex flex-col">
          <span>{a.contact_name}</span>
          <span className="font-mono text-xs text-muted">{a.email}</span>
        </span>
      ),
      sortValue: (a) => a.contact_name,
    },
    { id: "submissions", header: "Submissions", align: "end", cell: (a) => String(a.submissions), sortValue: (a) => a.submissions },
    { id: "created", header: "Received", align: "end", cell: (a) => formatDate(a.created_at), sortValue: (a) => a.created_at },
    { id: "status", header: "Status", cell: (a) => <StatusOf status={a.status} />, sortValue: (a) => a.status },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      cell: (a) =>
        a.status !== "pending" ? null : (
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRejecting(a);
              }}
            >
              Reject
            </Button>
            <Button
              onClick={() => {
                setApproving(a);
              }}
            >
              Approve
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader title="Applications" subtitle="Clinics that asked to join Aarogyam" />
      <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Tile label="Waiting for a decision" value={counts.pending} tone="warning" note={counts.pending === 0 ? "All caught up" : "Approve or reject below"} />
        <Tile label="Approved" value={counts.approved} tone="success" note="Clinic created, owner invited" />
        <Tile label="Rejected" value={counts.rejected} note="Reason kept for the console" />
        <Tile label="All applications" value={counts.all} tone="info" />
      </div>
      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ChipFilterGroup
            label="Filter applications by status"
            options={[
              { value: "pending", label: `Pending (${String(counts.pending)})` },
              { value: "approved", label: `Approved (${String(counts.approved)})` },
              { value: "rejected", label: `Rejected (${String(counts.rejected)})` },
              { value: "all", label: `All (${String(counts.all)})` },
            ]}
            value={[status]}
            onValueChange={(value) => {
              setStatus(value[0] ?? "pending");
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput label="Search applications" placeholder="Clinic, city, contact or email" value={query} onValueChange={setQuery} className="sm:w-72" />
            <Select options={SPECIALTIES} value={specialty} onValueChange={setSpecialty} aria-label="Filter by specialty" />
          </div>
        </div>
        {applications.isError ? (
          <ApiErrorNotice title="Couldn't load applications" error={applications.error} onRetry={() => void applications.refetch()} />
        ) : (
          <>
            <p role="status" className="mb-2 text-xs text-muted">
              {applications.isPending ? "Loading…" : `Showing ${String(rows.length)} of ${String(counts.all)} applications`}
            </p>
            <DataTable
              caption="Applications"
              columns={columns}
              rows={rows}
              rowKey={(a) => a.id}
              loading={applications.isPending}
              defaultSort={{ columnId: "created", direction: "descending" }}
              empty={
                filtered && counts.all > 0
                  ? { title: "No applications match", description: "Try another status, specialty or search.", icon: <Inbox className="size-7" /> }
                  : { title: "No applications yet", description: "They'll show up as clinics register.", icon: <Inbox className="size-7" /> }
              }
            />
          </>
        )}
      </Card>
      <DetailDrawer
        application={viewing}
        onClose={() => {
          setViewing(undefined);
        }}
        onApprove={(a) => {
          setViewing(undefined);
          setApproving(a);
        }}
        onReject={(a) => {
          setViewing(undefined);
          setRejecting(a);
        }}
      />
      <ApproveDialog
        application={approving}
        onClose={() => {
          setApproving(undefined);
        }}
      />
      <RejectDialog
        application={rejecting}
        onClose={() => {
          setRejecting(undefined);
        }}
      />
    </>
  );
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 text-muted">
        {icon}
      </span>
      <div>
        <dt className="text-xs font-semibold text-muted">{label}</dt>
        <dd className="text-sm text-text">{children}</dd>
      </div>
    </div>
  );
}

function DetailDrawer({
  application,
  onClose,
  onApprove,
  onReject,
}: {
  application: Application | undefined;
  onClose: () => void;
  onApprove: (application: Application) => void;
  onReject: (application: Application) => void;
}) {
  return (
    <Drawer
      open={application !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={application?.clinic_name ?? "Application"}
      description={application === undefined ? undefined : `${application.city} · ${specialtyName(application.specialty)}`}
      footer={
        application?.status === "pending" ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                onReject(application);
              }}
            >
              Reject…
            </Button>
            <Button
              onClick={() => {
                onApprove(application);
              }}
            >
              Approve…
            </Button>
          </>
        ) : undefined
      }
    >
      {application === undefined ? null : (
        <div className="flex flex-col gap-5">
          <StatusOf status={application.status} />
          <dl className="flex flex-col gap-4">
            <Detail icon={<Mail className="size-4" />} label="Contact">
              {application.contact_name}
              <br />
              <span className="font-mono text-xs">{application.email}</span>
            </Detail>
            {application.phone == null ? null : (
              <Detail icon={<Phone className="size-4" />} label="Phone">
                {application.phone}
              </Detail>
            )}
            <Detail icon={<MapPin className="size-4" />} label="Location">
              {application.city}
            </Detail>
            <Detail icon={<Inbox className="size-4" />} label="Received">
              {formatDateTime(application.created_at)} · {application.submissions === 1 ? "submitted once" : `submitted ${String(application.submissions)} times`}
            </Detail>
            {application.message == null ? null : <Detail icon={<Mail className="size-4" />} label="Their note">{application.message}</Detail>}
          </dl>
          {application.status === "pending" ? null : (
            <div className="rounded-xl bg-surface-muted px-4 py-3 text-sm">
              <p className="font-semibold text-text">
                {STATUS_LABEL[application.status] ?? application.status}
                {application.decided_at == null ? "" : ` on ${formatDate(application.decided_at)}`}
              </p>
              {application.decision_reason == null ? null : <p className="mt-1 text-muted">Reason: {application.decision_reason}</p>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ApproveDialog({ application, onClose }: { application: Application | undefined; onClose: () => void }) {
  const approve = useApproveApplication();
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ invite_link: string; portal_host: string; invite_expires_at: string }>();

  const close = () => {
    onClose();
    setSlug("");
    setError(undefined);
    setCreated(undefined);
  };

  const submit = () => {
    if (application === undefined) {
      return;
    }
    setError(undefined);
    approve.mutate(
      { id: application.id, input: { slug: slug.trim() === "" ? null : slug.trim() } },
      {
        onSuccess: setCreated,
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't approve this application. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={application !== undefined}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={created === undefined ? "Approve this application" : "Clinic created"}
      description={created === undefined ? application?.clinic_name : `${created.portal_host} is ready for its owner.`}
      dismissOnOutsidePress={created === undefined}
      footer={
        created === undefined ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button icon={<Check aria-hidden="true" className="size-4" />} onClick={submit} disabled={approve.isPending}>
              {approve.isPending ? "Approving…" : "Approve"}
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
          <p className="text-sm text-muted">
            This creates <strong className="text-text">{application?.clinic_name}</strong> on Aarogyam and sends an owner invitation to{" "}
            <strong className="text-text">{application?.email}</strong>. It can't be undone from here.
          </p>
          <Field label="Subdomain" hint={`Leave blank to use "${slugify(application?.clinic_name ?? "")}", derived from the clinic's name.`}>
            <TextInput
              spellCheck={false}
              autoCapitalize="none"
              value={slug}
              onChange={(event) => {
                setSlug(event.currentTarget.value);
              }}
            />
          </Field>
          {error === undefined ? null : (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            It works once, for {application?.email}, until {formatDate(created.invite_expires_at)}. It was also emailed; share it privately.
          </p>
          <Field label="Invitation link">
            <TextInput readOnly value={created.invite_link} className="font-mono" onFocus={(event) => { event.currentTarget.select(); }} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

function RejectDialog({ application, onClose }: { application: Application | undefined; onClose: () => void }) {
  const reject = useRejectApplication();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();

  const close = () => {
    onClose();
    setReason("");
    setTouched(false);
    setError(undefined);
  };

  const problem = touched ? reasonProblem(reason) : undefined;

  const submit = () => {
    if (application === undefined) {
      return;
    }
    if (reasonProblem(reason) !== undefined) {
      setTouched(true);
      return;
    }
    setError(undefined);
    reject.mutate(
      { id: application.id, input: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.show({ title: `Rejected ${application.clinic_name}`, tone: "neutral" });
          close();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't reject this application. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={application !== undefined}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Reject this application"
      description={application?.clinic_name}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            className="border-danger text-danger-text hover:bg-danger-soft"
            icon={<X aria-hidden="true" className="size-4" />}
            onClick={submit}
            disabled={reject.isPending}
          >
            {reject.isPending ? "Rejecting…" : "Reject"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Quick answers" className="flex flex-wrap gap-2">
          {REJECT_REASONS.map((text) => (
            <button
              key={text}
              type="button"
              className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => {
                setReason(text);
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <Field label="Reason" hint="Kept with the decision for the console; not shown to the applicant." error={problem} required>
          <TextArea
            rows={3}
            value={reason}
            onBlur={() => {
              setTouched(true);
            }}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
