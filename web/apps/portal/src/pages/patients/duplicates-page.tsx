import { useState } from "react";
import { Link } from "react-router";

import { apiErrorOf, type PossibleDuplicate } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Dialog, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useDismissDuplicate, useMergePatient, usePatientDuplicates } from "../../queries.js";
import { EmptyState, PageHeader } from "../../components/mk/index.js";

/** Patients -> Possible duplicates: online sign-ups whose phone matches an existing patient, to merge or keep apart. */
export function DuplicatesPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Possible duplicates", session.clinic.name);
  if (!can("patients.read")) {
    return <EmptyState title="You can't see patients" description="Ask the clinic's owner if you need to." />;
  }
  return <DuplicatesList canEdit={can("patients.write")} />;
}

function Side({ side }: { side: PossibleDuplicate["patient"] }) {
  const facts = [side.sex === "unknown" ? null : side.sex, side.age_years == null ? null : `${String(side.age_years)} y`].filter((f) => f !== null);
  return (
    <Link to={`/patients/${side.id}`} className="font-medium underline-offset-2 hover:underline">
      {side.full_name} <span className="text-muted">{side.number}</span>
      {facts.length === 0 ? null : <span className="block text-xs font-normal text-muted">{facts.join(" · ")}</span>}
    </Link>
  );
}

function DuplicatesList({ canEdit }: { canEdit: boolean }) {
  const list = usePatientDuplicates();
  const columns: DataTableColumn<PossibleDuplicate>[] = [
    { id: "signup", header: "Online sign-up", cell: (d) => <Side side={d.patient} /> },
    { id: "existing", header: "Matches existing patient", cell: (d) => <Side side={d.candidate} /> },
    { id: "reason", header: "Why", cell: () => "Same phone number" },
  ];
  if (canEdit) {
    columns.push({ id: "actions", header: "Actions", cell: (d) => <RowActions duplicate={d} /> });
  }
  return (
    <>
      <PageHeader
        title="Possible duplicates"
        subtitle="People who signed up online with a phone number an existing patient already has. Merge them if it is the same person."
      />
      {list.isError ? (
        <ApiErrorNotice title="Couldn't load possible duplicates" error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <Card>
          <DataTable
            caption="Possible duplicate patients"
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(d) => d.id}
            loading={list.isPending}
            empty={{ title: "No possible duplicates", description: "Online sign-ups that match an existing patient's phone show here." }}
            pageSize={25}
          />
        </Card>
      )}
    </>
  );
}

function RowActions({ duplicate }: { duplicate: PossibleDuplicate }) {
  const toast = useToast();
  const dismiss = useDismissDuplicate();
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="flex flex-wrap gap-2">
      <Button
        onClick={() => {
          setConfirming(true);
        }}
      >
        Same person: merge
      </Button>
      <Button
        variant="ghost"
        disabled={dismiss.isPending}
        onClick={() => {
          dismiss.mutate(duplicate.id, {
            onError: (thrown) => {
              toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't update the list.", tone: "danger" });
            },
          });
        }}
      >
        Different people
      </Button>
      {confirming ? (
        <ConfirmMerge
          duplicate={duplicate}
          onClose={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </span>
  );
}

/** Merging can't be undone, so it asks first, naming the record that stays. */
function ConfirmMerge({ duplicate, onClose }: { duplicate: PossibleDuplicate; onClose: () => void }) {
  const merge = useMergePatient();
  const [error, setError] = useState<string | undefined>(undefined);
  const { patient: signup, candidate } = duplicate;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Merge these records?"
      description={`${signup.full_name} (${signup.number}) will be merged into ${candidate.full_name} (${candidate.number}). Appointments, queue tokens and consents move to ${candidate.number}. This can't be undone.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={merge.isPending}
            onClick={() => {
              merge.mutate(
                { id: signup.id, into: candidate.id },
                {
                  onSuccess: onClose,
                  onError: (thrown) => {
                    setError(apiErrorOf(thrown)?.message ?? "Couldn't merge them. Please try again.");
                  },
                },
              );
            }}
          >
            {merge.isPending ? "Merging…" : "Merge"}
          </Button>
        </>
      }
    >
      {error === undefined ? <p className="text-sm text-muted">Their name stays on {candidate.number}.</p> : (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </Dialog>
  );
}
