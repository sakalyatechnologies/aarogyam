/**
 * Family on Patient 360: the patient's relatives in this clinic, each a link to their page with the relation. Reading
 * follows patients.read; adding and removing need patients.write, as the API does.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { apiErrorOf, unwrap, type FamilyLink, type FamilyRelation, type Patient, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Button, Dialog, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { RELATION_OPTIONS, relationLabel } from "../../../lib/family.js";
import { usePatients } from "../../../queries.js";
import { Bento } from "./kit.js";
import "../../../components/quick-picks.css";

function useFamily(id: PatientId) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["family", access.org_id, id],
    queryFn: ({ signal }) => unwrap(api.listFamily(id, { signal })),
  });
}

/** A link is listed from both sides, so both patients' lists are refreshed. */
function useFamilyChange(id: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const done = () => queryClient.invalidateQueries({ queryKey: ["family", access.org_id] });
  const add = useMutation({
    mutationFn: (input: { related: PatientId; relation: FamilyRelation }) => unwrap(api.addFamilyLink(id, { related_patient_id: input.related, relation: input.relation })),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: (linkId: string) => unwrap(api.removeFamilyLink(id, linkId)), onSuccess: done });
  return { add, remove };
}

function AddRelative({ patientId, linked, onDone }: { patientId: PatientId; linked: ReadonlySet<string>; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [relation, setRelation] = useState<FamilyRelation>("child");
  const [error, setError] = useState<string | undefined>(undefined);
  const toast = useToast();
  const term = q.trim();
  const found = usePatients(term, term.length >= 2);
  const { add } = useFamilyChange(patientId);
  const options = term.length < 2 ? [] : (found.data?.items ?? []).filter((p) => p.id !== patientId && !linked.has(p.id)).slice(0, 5);
  const pick = (related: Patient) => {
    setError(undefined);
    add.mutate(
      { related: related.id, relation },
      {
        onSuccess: () => {
          toast.show({ title: `${related.full_name} added as family`, tone: "success" });
          onDone();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't add the family member. Please try again.");
        },
      },
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="qp-label" htmlFor="family-search">
        Find a patient
      </label>
      <TextInput
        id="family-search"
        autoComplete="off"
        placeholder="Name or number"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
        }}
      />
      <p className="qp-label">They are this patient's…</p>
      <div className="qp-chips" role="group" aria-label="Relation">
        {RELATION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="qp-chip"
            aria-pressed={relation === option.value}
            onClick={() => {
              setRelation(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {options.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Matching patients">
          {options.map((p) => (
            <li key={p.id}>
              <button type="button" className="wi-match" disabled={add.isPending} onClick={() => { pick(p); }}>
                <span className="wi-match-t">
                  <b>{p.full_name}</b>
                  <span>{p.number}</span>
                </span>
                <span className="text-xs font-semibold text-primary-text">Add as {relationLabel(relation).toLowerCase()}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : term.length >= 2 && !found.isFetching ? (
        <p className="mk-hint">No other patient matches.</p>
      ) : null}
      {error === undefined ? null : (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function FamilyBlock({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const family = useFamily(patientId);
  const { remove } = useFamilyChange(patientId);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FamilyLink | undefined>(undefined);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);
  if (!can("patients.read")) return null;
  const canWrite = can("patients.write");
  const items = family.data?.items ?? [];
  return (
    <Bento
      title="Family"
      flat
      action={
        canWrite && !adding ? (
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" /> Add family
          </Button>
        ) : undefined
      }
    >
      {family.isPending ? (
        <SkeletonRows count={2} label="Loading family" />
      ) : family.isError ? (
        <ApiErrorNotice title="Couldn't load family" error={family.error} onRetry={() => void family.refetch()} />
      ) : items.length === 0 ? (
        <p className="mk-hint">No family linked yet.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Family members">
          {items.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2">
              <Link to={`/patients/${link.patient_id}`} className="text-sm font-semibold text-primary-text">
                {link.full_name}
              </Link>
              <span className="flex items-center gap-2 text-xs">
                <span>{relationLabel(link.relation)}</span>
                {canWrite ? (
                  <button
                    type="button"
                    aria-label={`Remove ${link.full_name}`}
                    onClick={() => {
                      setRemoveError(undefined);
                      setRemoving(link);
                    }}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && adding ? (
        <div style={{ marginTop: 8 }}>
          <AddRelative
            patientId={patientId}
            linked={new Set(items.map((l) => l.patient_id))}
            onDone={() => {
              setAdding(false);
            }}
          />
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      <Dialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        title="Remove family link?"
        description={removing === undefined ? undefined : `${removing.full_name} will no longer be listed as family. Their record stays.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRemoving(undefined);
              }}
            >
              Keep
            </Button>
            <Button
              disabled={remove.isPending}
              onClick={() => {
                if (removing === undefined) return;
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    toast.show({ title: `${removing.full_name} removed from family`, tone: "success" });
                    setRemoving(undefined);
                  },
                  onError: (thrown) => {
                    setRemoveError(apiErrorOf(thrown)?.message ?? "Couldn't remove the link. Please try again.");
                  },
                });
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        {removeError === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {removeError}
          </p>
        )}
      </Dialog>
    </Bento>
  );
}
