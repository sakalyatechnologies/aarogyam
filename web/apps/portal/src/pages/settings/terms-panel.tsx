import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiErrorOf, unwrap, type DentalTermKind, type OwnDentalTerm } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Button, Field, TextInput } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { EmptyState, MkCard } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const KINDS: readonly { kind: DentalTermKind; title: string; one: string }[] = [
  { kind: "procedure", title: "Procedures", one: "procedure" },
  { kind: "material", title: "Materials", one: "material" },
];

// ---------------------------------------------------------------------------------------------
// Data

function useTermKey() {
  const { access } = useClinic();
  return ["dental-terms", access.org_id] as const;
}

function useOwnTerms() {
  const { api } = useClinic();
  const key = useTermKey();
  return useQuery({ queryKey: key, queryFn: ({ signal }) => unwrap(api.listOwnDentalTerms({ signal })) });
}

type TermChange = { op: "rename"; id: string; label: string } | { op: "retire" | "restore"; id: string };

/** Renames, retires or restores a term, then refreshes this list and the tooth chart's type-ahead. */
function useChangeTerm() {
  const { api, access } = useClinic();
  const key = useTermKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: TermChange) => {
      if (change.op === "rename") return unwrap(api.renameDentalTerm(change.id, { label: change.label }));
      return unwrap(change.op === "retire" ? api.retireDentalTerm(change.id) : api.restoreDentalTerm(change.id));
    },
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ["dental-chart", access.org_id] })]),
  });
}

function useAddTerm() {
  const { api, access } = useClinic();
  const key = useTermKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: DentalTermKind; label: string }) => unwrap(api.addDentalTerm(input)),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ["dental-chart", access.org_id] })]),
  });
}

// ---------------------------------------------------------------------------------------------
// Panel

/** Settings → Treatment terms: the clinic's own procedure and material names, from the tooth chart's "Add new". */
export function TermsPanel() {
  const { can } = useClinic();
  const list = useOwnTerms();
  if (list.isPending) return <SkeletonRows label="Loading treatment terms" />;
  if (list.isError) return <ApiErrorNotice title="Couldn't load treatment terms" error={list.error} onRetry={() => void list.refetch()} />;
  const items = list.data.items;
  const retired = items.filter((t) => t.retired);
  return (
    <div className="flex flex-col gap-6 st-terms">
      {KINDS.map(({ kind, title, one }) => (
        <KindCard key={kind} kind={kind} title={title} one={one} terms={items.filter((t) => t.kind === kind && !t.retired)} canAdd={can("clinical.write")} />
      ))}
      <RetiredGroup terms={retired} />
    </div>
  );
}

function KindCard({ kind, title, one, terms, canAdd }: { kind: DentalTermKind; title: string; one: string; terms: OwnDentalTerm[]; canAdd: boolean }) {
  return (
    <MkCard title={title} hint={`The ${one} names your clinic added on the tooth chart. Standard names are not listed here. A new name shows on old records too.`}>
      {terms.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} of your own yet`} description="Names you add on the tooth chart show up here." />
      ) : (
        <ul className="divide-y divide-border" aria-label={title}>
          {terms.map((term) => (
            <TermRow key={term.id} term={term} />
          ))}
        </ul>
      )}
      {canAdd ? <AddTerm kind={kind} one={one} /> : null}
    </MkCard>
  );
}

function TermRow({ term }: { term: OwnDentalTerm }) {
  const change = useChangeTerm();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const run = (next: TermChange, done: () => void = () => undefined) => {
    setError(undefined);
    change.mutate(next, {
      onSuccess: done,
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't save that.");
      },
    });
  };
  return (
    <li className="flex flex-col gap-2 py-3">
      {draft === undefined ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold text-text">{term.label}</span>
          <span className="flex gap-2">
            <Button variant="ghost" aria-label={`Rename ${term.label}`} onClick={() => { setDraft(term.label); }}>
              Rename
            </Button>
            <Button variant="ghost" aria-label={`Retire ${term.label}`} disabled={change.isPending} onClick={() => { run({ op: "retire", id: term.id }); }}>
              Retire
            </Button>
          </span>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run({ op: "rename", id: term.id, label: draft }, () => { setDraft(undefined); });
          }}
        >
          <Field label={`New name for ${term.label}`} hideLabel error={error} className="min-w-56 flex-1">
            <TextInput value={draft} maxLength={80} autoFocus onChange={(event) => { setDraft(event.target.value); }} />
          </Field>
          <Button type="submit" disabled={change.isPending || draft.trim() === ""}>Save</Button>
          <Button variant="secondary" onClick={() => { setDraft(undefined); setError(undefined); }}>Cancel</Button>
        </form>
      )}
      {draft === undefined && error !== undefined ? <p role="alert" className="m-0 text-xs text-danger-text">{error}</p> : null}
    </li>
  );
}

function AddTerm({ kind, one }: { kind: DentalTermKind; one: string }) {
  const add = useAddTerm();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        add.mutate({ kind, label: label.trim() }, {
          onSuccess: () => { setLabel(""); },
          onError: (thrown) => { setError(apiErrorOf(thrown)?.message ?? "Couldn't add that."); },
        });
      }}
    >
      <Field label={`Add ${one}`} error={error} className="min-w-56 flex-1">
        <TextInput value={label} maxLength={80} onChange={(event) => { setLabel(event.target.value); }} />
      </Field>
      <Button type="submit" variant="secondary" disabled={add.isPending || label.trim() === ""}>Add term</Button>
    </form>
  );
}

/** Retired names stay readable: old chart entries keep showing them. */
function RetiredGroup({ terms }: { terms: OwnDentalTerm[] }) {
  const change = useChangeTerm();
  const [error, setError] = useState<string | undefined>(undefined);
  if (terms.length === 0) return null;
  return (
    <MkCard>
      <details>
        <summary className="cursor-pointer text-sm font-bold text-text">Retired ({terms.length})</summary>
        <p className="mk-hint">Not offered for new entries. Old records still show them.</p>
        <ul className="divide-y divide-border" aria-label="Retired terms">
          {terms.map((term) => (
            <li key={term.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="text-sm text-text">
                {term.label} <span className="text-xs text-muted">· {term.kind === "procedure" ? "Procedure" : "Material"}</span>
              </span>
              <Button
                variant="ghost"
                aria-label={`Restore ${term.label}`}
                disabled={change.isPending}
                onClick={() => {
                  setError(undefined);
                  change.mutate({ op: "restore", id: term.id }, { onError: (thrown) => { setError(apiErrorOf(thrown)?.message ?? "Couldn't restore that."); } });
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
        {error === undefined ? null : <p role="alert" className="m-0 text-xs text-danger-text">{error}</p>}
      </details>
    </MkCard>
  );
}
