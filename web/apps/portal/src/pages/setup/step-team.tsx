import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { apiErrorOf } from "@aarogyam/api-client";
import { Skeleton } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useInviteStaff, useRoles } from "../../queries.js";
import { StepFrame, type StepProps } from "./step-frame.js";

interface InviteRow {
  key: number;
  email: string;
  role: string;
}

/** Step 5: invite staff by email and role, and a way into the existing patient import. Both optional. */
export function TeamStep({ props }: { props: StepProps }) {
  const { can } = useClinic();
  const roles = useRoles();
  const invite = useInviteStaff();
  const [rows, setRows] = useState<InviteRow[]>([{ key: 1, email: "", role: "" }]);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (roles.isPending) {
    return <Skeleton shape="block" />;
  }
  const assignable = (roles.data?.items ?? []).filter((role) => role.key !== "owner");
  const canInvite = can("staff.manage");

  const save = async () => {
    setError(undefined);
    const filled = rows.filter((row) => row.email.trim() !== "");
    if (filled.some((row) => row.role === "")) {
      setError("Choose a role for each person you invite.");
      return;
    }
    setBusy(true);
    try {
      for (const row of filled) {
        await invite.mutateAsync({ email: row.email.trim(), role_key: row.role });
        setSent((prev) => [...prev, row.email.trim()]);
        setRows((prev) => prev.filter((r) => r.key !== row.key));
      }
      await props.done();
    } catch (thrown) {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't send an invitation. Please check the email and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      title="Team and patients"
      hint="Both are optional. Invite people now or later from Settings."
      props={props}
      onContinue={() => void save()}
      busy={busy}
      error={error}
      continueLabel={rows.some((row) => row.email.trim() !== "") ? "Send invitations" : "Continue"}
    >
      <h3 className="mk-flabel" style={{ marginTop: 0 }}>
        Invite your team
      </h3>
      {canInvite ? (
        <>
          <ul className="sw-invites">
            {rows.map((row, index) => (
              <li key={row.key} className="sw-invite">
                <input
                  type="email"
                  className="mk-tin"
                  aria-label={`Email of person ${String(index + 1)}`}
                  placeholder="name@example.com"
                  autoComplete="off"
                  value={row.email}
                  onChange={(event) => {
                    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, email: event.target.value } : r)));
                  }}
                />
                <select
                  className="mk-tin"
                  aria-label={`Role of person ${String(index + 1)}`}
                  value={row.role}
                  onChange={(event) => {
                    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, role: event.target.value } : r)));
                  }}
                >
                  <option value="">Choose a role</option>
                  {assignable.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name}
                    </option>
                  ))}
                </select>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    className="sw-link"
                    onClick={() => {
                      setRows((prev) => prev.filter((r) => r.key !== row.key));
                    }}
                  >
                    Remove
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="sw-link"
            onClick={() => {
              setRows((prev) => [...prev, { key: Math.max(0, ...prev.map((r) => r.key)) + 1, email: "", role: "" }]);
            }}
          >
            <Plus aria-hidden="true" /> Add another person
          </button>
          {sent.length === 0 ? null : (
            <ul className="sw-sent" aria-label="Invitations sent">
              {sent.map((email) => (
                <li key={email}>Invited {email}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mk-hint">Only people who manage staff can invite them.</p>
      )}

      <h3 className="mk-flabel">Bring your patients</h3>
      <div className="sw-import">
        <div>
          <b>Import patients from a file</b>
          <p>Upload a CSV (in Excel, use Save as &rarr; CSV), match the columns and check every row first.</p>
        </div>
        <Link className="mk-btn mk-btn-ghost" to="/patients/import">
          Open the importer
        </Link>
      </div>
    </StepFrame>
  );
}
