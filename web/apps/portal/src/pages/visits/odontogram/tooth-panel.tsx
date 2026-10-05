import { Button } from "@sakalya/ui";
import { formatDate } from "@aarogyam/app-kit";
import type { PatientId, ToothSurface } from "@aarogyam/api-client";

import { useToothHistory } from "../queries.js";
import { FindingSwatch, StatusGlyph } from "./tooth-svg.js";
import { EMPTY_STATE, FINDING_STYLE, SURFACES, TREATMENT_LABEL, headline, kindName, surfaceCode, surfaceLabel, type ToothState } from "./model.js";

export interface ToothPanelProps {
  patientId: PatientId;
  tooth: number | undefined;
  surface: ToothSurface | null;
  state: ToothState | undefined;
  onSurface: (surface: ToothSurface | null) => void;
  onRecord: ((tooth: number, surface: ToothSurface | null) => void) | undefined;
}

/** The selected tooth: what is on it now, planned and done treatment, a surface picker and its full history. */
export function ToothPanel({ patientId, tooth, surface, state, onSurface, onRecord }: ToothPanelProps) {
  const history = useToothHistory(patientId, tooth);
  if (tooth === undefined) {
    return (
      <aside className="odo-panel" aria-label="Selected tooth">
        <h3>No tooth selected</h3>
        <p className="odo-muted">Pick a tooth or one of its surfaces to see its history and record a finding.</p>
      </aside>
    );
  }
  const current = state ?? EMPTY_STATE(tooth);
  const headFinding = headline(current);
  return (
    <aside className="odo-panel" aria-label="Selected tooth" aria-live="polite">
      <div>
        <h3>{`Tooth ${String(tooth)}`}</h3>
        <p className="odo-muted">{kindName(tooth)}</p>
      </div>
      <div role="group" aria-label="Choose surface">
        <p className="odo-hint" id="odo-surface-hint">
          Surface
        </p>
        <div className="odo-surface-pick">
          <button
            type="button"
            aria-pressed={surface === null}
            title="Whole tooth"
            onClick={() => {
              onSurface(null);
            }}
          >
            All
          </button>
          {SURFACES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={surface === s}
              aria-label={`${surfaceLabel(tooth, s)} surface`}
              title={surfaceLabel(tooth, s)}
              onClick={() => {
                onSurface(s);
              }}
            >
              {surfaceCode(tooth, s)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="odo-hint">Now</p>
        <ul className="odo-history">
          {current.whole !== undefined ? (
            <li>
              <FindingSwatch finding={current.whole} />
              <span>{`${FINDING_STYLE[current.whole].label}, whole tooth`}</span>
            </li>
          ) : null}
          {SURFACES.flatMap((s) => {
            const finding = current.surfaces[s];
            return finding === undefined ? [] : [{ s, finding }];
          }).map(({ s, finding }) => (
            <li key={s}>
              <FindingSwatch finding={finding} />
              <span>{`${FINDING_STYLE[finding].label}, ${surfaceLabel(tooth, s).toLowerCase()}`}</span>
            </li>
          ))}
          {headFinding === "sound" && current.whole === undefined ? <li><FindingSwatch finding="sound" /><span>Sound</span></li> : null}
          {current.treatments.map((mark) => (
            <li key={mark.id}>
              <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
                <StatusGlyph mark={mark} x={0} y={0} />
              </svg>
              <span>
                <span className="odo-chip" data-state={mark.state}>
                  {TREATMENT_LABEL[mark.state]}
                </span>{" "}
                {mark.name}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {onRecord === undefined ? null : (
        <Button
          onClick={() => {
            onRecord(tooth, surface);
          }}
          aria-label={`Record a finding for tooth ${String(tooth)} (now ${FINDING_STYLE[headFinding].label})`}
        >
          Record a finding
        </Button>
      )}
      <div>
        <p className="odo-hint">History</p>
        {history.isPending ? (
          <p className="odo-muted">Loading history…</p>
        ) : history.isError ? (
          <p className="odo-muted" role="alert">
            Couldn't load this tooth's history.
          </p>
        ) : history.data.history.length === 0 ? (
          <p className="odo-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="odo-history" aria-label={`History of tooth ${String(tooth)}`}>
            {history.data.history.map((entry) => (
              <li key={entry.id} className={entry.status === "current" ? undefined : "odo-superseded"}>
                <FindingSwatch finding={entry.finding} />
                <span>
                  <b>{FINDING_STYLE[entry.finding].label}</b>
                  {entry.surface == null ? "" : `, ${surfaceLabel(tooth, entry.surface).toLowerCase()}`}
                  {entry.status === "current" ? "" : entry.status === "superseded" ? " (superseded)" : " (entered in error)"}
                  <br />
                  <time dateTime={entry.effective_at}>{formatDate(entry.effective_at)}</time>
                  {entry.note == null || entry.note === "" ? null : ` · ${entry.note}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
