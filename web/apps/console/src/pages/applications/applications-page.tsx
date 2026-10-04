import { Copy, Inbox } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Application, type ApplicationStatus, type ApprovedApplication } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, useDocumentTitle } from "@aarogyam/app-kit";
import {
  Button,
  Card,
  ChipFilterGroup,
  DataTable,
  Dialog,
  Field,
  PageHeader,
  Pill,
  TextArea,
  TextInput,
  useToast,
  type DataTableColumn,
} from "@sakalya/ui";

import { useApplications, useApproveApplication, useRejectApplication } from "../../api.js";

const FILTERS: readonly { value: ApplicationStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function statusTone(status: string) {
  return status === "pending" ? "warning" : status === "approved" ? "success" : "neutral";
}

export function ApplicationsPage() {
  useDocumentTitle("Applications", "Sakalya Console");
  const [filter, setFilter] = useState<ApplicationStatus | "all">("pending");
  const applications = useApplications(filter === "all" ? undefined : filter);
  const [approving, setApproving] = useState<Application>();
  const [rejecting, setRejecting] = useState<Application>();

  const columns: readonly DataTableColumn<Application>[] = [
    { id: "clinic", header: "Clinic", cell: (a) => <span className="font-semibold">{a.clinic_name}</span>, sortValue: (a) => a.clinic_name },
    { id: "city", header: "City", cell: (a) => a.city },
    { id: "specialty", header: "Specialty", cell: (a) => (a.specialty === "dental" ? "Dental" : "General") },
    { id: "contact", header: "Contact", cell: (a) => <span className="font-mono text-xs">{a.email}</span> },
    {
      id: "submissions",
      header: "Submissions",
      align: "end",
      cell: (a) => String(a.submissions),
      sortValue: (a) => a.submissions,
    },
    { id: "created", header: "Received", align: "end", cell: (a) => formatDate(a.created_at), sortValue: (a) => a.created_at },
    {
      id: "status",
      header: "Status",
      cell: (a) => <Pill tone={statusTone(a.status)}>{a.status}</Pill>,
      sortValue: (a) => a.status,
    },
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
      <Card>
        <ChipFilterGroup
          label="Filter applications"
          options={FILTERS}
          value={[filter]}
          onValueChange={(value) => {
            setFilter(value[0] ?? "pending");
          }}
          className="mb-4"
        />
        {applications.isError ? (
          <ApiErrorNotice title="Couldn't load applications" error={applications.error} onRetry={() => void applications.refetch()} />
        ) : (
          <DataTable
            caption="Applications"
            columns={columns}
            rows={applications.data?.items ?? []}
            rowKey={(a) => a.id}
            loading={applications.isPending}
            defaultSort={{ columnId: "created", direction: "descending" }}
            empty={{ title: "No applications here", description: "They'll show up as clinics register.", icon: <Inbox className="size-7" /> }}
          />
        )}
      </Card>
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

function ApproveDialog({ application, onClose }: { application: Application | undefined; onClose: () => void }) {
  const approve = useApproveApplication();
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<ApprovedApplication>();

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
            <Button onClick={submit} disabled={approve.isPending}>
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
          <Field label="Subdomain" hint="Leave blank to derive it from the clinic's name.">
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
  const [error, setError] = useState<string>();

  const close = () => {
    onClose();
    setReason("");
    setError(undefined);
  };

  const submit = () => {
    if (application === undefined) {
      return;
    }
    setError(undefined);
    reject.mutate(
      { id: application.id, input: { reason: reason.trim() === "" ? null : reason.trim() } },
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
            onClick={submit}
            disabled={reject.isPending}
          >
            {reject.isPending ? "Rejecting…" : "Reject"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" hint="For the console only; not shown to the applicant.">
          <TextArea
            rows={3}
            value={reason}
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
