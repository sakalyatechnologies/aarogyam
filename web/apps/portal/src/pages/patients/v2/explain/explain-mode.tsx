/**
 * Explain mode: the doctor turns the screen to the patient. Full screen, large type, and only an allowlist on it: the image
 * with numbered pins, the chart in Health view, and a summary in plain words. No phone, balance, notes or staff names other
 * than the treating doctor's. Pins and the laser pointer live in this session only; nothing is saved. Leaving needs a
 * one-second hold on Exit, or Esc, so a patient tapping around can't land in Patient 360.
 */
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";

import type { Attachment, PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees } from "@aarogyam/app-kit";
import { usePortalTheme } from "@sakalya/ui";

import { SkeletonRows } from "../../../../components/skeleton-rows.js";
import { useClinic } from "../../../../clinic.js";
import { useAttachments, useDentalChart, useProcedures, useStaff, useVisits } from "../../../../queries.js";
import { usePlans } from "../../../treatment-plans/queries.js";
import { isPrimary } from "../../../visits/odontogram/model.js";
import { useAttachmentLink } from "../attachment-link.js";
import { FileThumb } from "../../file-thumb.js";
import { healthLabel, toothName } from "../tooth-chart/model.js";
import { ProgressLine } from "../tooth-chart/progress-line.js";
import { ToothChart } from "../tooth-chart/tooth-chart.js";
import { useNoteDictation } from "../tooth-chart/use-note-dictation.js";
import { containedRect, explainImages, explainSummary, fractionIn, isFdi, type Rect } from "./explain-model.js";
import "./explain.css";
import { HoldToExit } from "./hold-to-exit.js";

export { EXIT_HOLD_MS, HoldToExit } from "./hold-to-exit.js";

/** How long Exit must be held. */
/** How far the pointer moves while pressed before it is the laser pointer rather than a tap. */
const DRAG_PX = 8;
const LABEL_MAX = 80;

interface Pin {
  readonly id: number;
  readonly imageId: string;
  /** Fractions of the drawn image, so the pin stays on the tooth when the window changes size. */
  readonly x: number;
  readonly y: number;
  readonly tooth: number;
  readonly label: string;
}

interface PendingPin {
  readonly x: number;
  readonly y: number;
  readonly digits: string;
  readonly label: string;
}

/**
 * Explain mode as its own dialog, for a patient without a visit to show; with a visit, Show patient
 * hosts the same X-rays body in its tab (§1.12).
 */
export function ExplainMode({ patientId, imageId, onExit }: { patientId: PatientId; imageId?: string | undefined; onExit: () => void }) {
  const portal = usePortalTheme();
  return (
    <BaseDialog.Root
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        // Esc leaves; the pin picker catches its own Esc first
        if (!open && details.reason === "escape-key") onExit();
      }}
    >
      <BaseDialog.Portal {...portal}>
        <BaseDialog.Popup aria-modal="true" className="xp odo">
          <header className="xp-head">
            <BaseDialog.Title className="xp-title">Your teeth today</BaseDialog.Title>
            <HoldToExit onExit={onExit} />
          </header>
          <ExplainBody patientId={patientId} imageId={imageId} />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** The X-ray or photo with pins, the chart and the summary: Explain mode's body, also Show patient's X-rays tab. */
export function ExplainBody({ patientId, imageId }: { patientId: PatientId; imageId?: string | undefined }) {
  const { can } = useClinic();
  const chart = useDentalChart(patientId);
  const plans = usePlans(patientId);
  const procedures = useProcedures(can("clinical.read") ? patientId : undefined);
  const visits = useVisits(can("clinical.read") ? patientId : undefined);
  const attachments = useAttachments(patientId);
  const staff = useStaff(can("staff.manage"));

  const images = useMemo(() => explainImages(attachments.data?.items ?? []), [attachments.data]);
  const [chosenId, setChosenId] = useState<string | undefined>(imageId);
  const image = images.find((f) => f.id === chosenId) ?? images[0];
  const [pins, setPins] = useState<readonly Pin[]>([]);
  const [pending, setPending] = useState<PendingPin | undefined>(undefined);
  const [focusTooth, setFocusTooth] = useState<number | undefined>(undefined);
  const [hoverTooth, setHoverTooth] = useState<number | undefined>(undefined);
  const active = hoverTooth ?? focusTooth;
  const shown = pins.filter((p) => p.imageId === image?.id);
  const marked = new Set(shown.map((p) => p.tooth));

  const current = chart.data?.current ?? [];
  const statuses = chart.data?.statuses ?? [];
  const dentition = current.length > 0 && current.every((e) => isPrimary(e.tooth)) ? "child" : "adult";
  const members = staff.data?.members ?? [];
  const summary = explainSummary({
    current,
    statuses,
    plans: plans.data?.items ?? [],
    dentition,
    nameOf: (id) => members.find((m) => m.id === id)?.display_name,
  });

  const placePin = (pin: PendingPin, tooth: number) => {
    if (image === undefined) return;
    setPins((before) => [...before, { id: (before.at(-1)?.id ?? 0) + 1, imageId: image.id, x: pin.x, y: pin.y, tooth, label: pin.label.trim() }]);
    setPending(undefined);
    setFocusTooth(tooth);
  };

  // Esc closes the pin picker first (before the dialog or Present sees it)
  useEffect(() => {
    if (pending === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPending(undefined);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, [pending]);

  return (
    <div className="xp-grid">
      <section className="xp-pane xp-image" aria-label="Image">
        <ImagePane
          images={images}
          image={image}
          loading={attachments.isPending}
          pins={shown}
          pending={pending}
          active={active}
          onChoose={(file) => {
            setChosenId(file.id);
            setPending(undefined);
          }}
          onDrop={(x, y) => {
            setPending({ x, y, digits: "", label: "" });
          }}
          onPin={(pin) => {
            setFocusTooth((before) => (before === pin.tooth ? undefined : pin.tooth));
          }}
          onHoverPin={setHoverTooth}
          onPending={setPending}
          onPlace={placePin}
          onClear={() => {
            setPins((before) => before.filter((p) => p.imageId !== image?.id));
          }}
        />
      </section>
      <section className="xp-pane xp-chart" aria-label="Chart">
        {chart.isPending ? (
          <SkeletonRows count={2} tall label="Loading the dental chart" />
        ) : chart.isError ? (
          <ApiErrorNotice title="Couldn't load the dental chart" error={chart.error} onRetry={() => void chart.refetch()} />
        ) : (
          <ToothChart
            look="rows"
            dentition={dentition}
            view="health"
            current={current}
            statuses={statuses}
            planItems={[]}
            selected={active}
            marked={marked}
            onHover={setHoverTooth}
            onSelect={(tooth) => {
              // While a pin waits for its tooth, a tap on the chart picks it.
              if (pending !== undefined) setPending({ ...pending, digits: String(tooth) });
              else setFocusTooth((before) => (before === tooth ? undefined : tooth));
            }}
          />
        )}
        {active === undefined ? null : (
          <p className="xp-focus" aria-live="polite">
            {`Tooth ${String(active)}: ${toothName(active)}`}
          </p>
        )}
      </section>
      <section className="xp-pane xp-summary" aria-label="Summary">
        {chart.isPending || plans.isPending ? (
          <SkeletonRows count={3} label="Loading the summary" />
        ) : (
          <>
            <p className="xp-counts">{summary.counts}</p>
            {summary.notChecked === undefined ? null : <p className="xp-muted">{summary.notChecked}</p>}
            {summary.lines.length === 0 ? null : (
              <ul className="xp-lines" aria-label="What each tooth needs">
                {summary.lines.map((line, index) => (
                  <li key={line.tooth ?? `mouth-${String(index)}`} data-health={line.health} data-active={line.tooth !== undefined && line.tooth === active ? "" : undefined}>
                    <strong>{line.tooth === undefined ? "Whole mouth" : `Tooth ${String(line.tooth)}`}</strong>
                    {line.tooth === undefined ? null : <span className="xp-muted">{` (${healthLabel(line.health)})`}</span>}
                    {`: ${line.needs}. ${line.cost === "ask the doctor" ? "Cost: ask the doctor." : line.cost}`}
                    {line.advice === undefined ? null : <span className="xp-advice">{line.advice}.</span>}
                  </li>
                ))}
              </ul>
            )}
            {summary.totalPaise > 0 ? (
              <p className="xp-total">
                Total of planned estimates: <strong>{formatRupees(summary.totalPaise)}</strong> <span className="xp-muted">(final cost after examination)</span>
              </p>
            ) : null}
            <ProgressLine history={current} procedures={procedures.data?.items ?? []} since={visits.data?.items.map((v) => v.started_at).sort()[0]} />
          </>
        )}
      </section>
    </div>
  );
}

/** The chosen image with its pins, the picker of the patient's images, and the laser pointer. */
function ImagePane(props: {
  images: readonly Attachment[];
  image: Attachment | undefined;
  loading: boolean;
  pins: readonly Pin[];
  pending: PendingPin | undefined;
  active: number | undefined;
  onChoose: (file: Attachment) => void;
  onDrop: (x: number, y: number) => void;
  onPin: (pin: Pin) => void;
  onHoverPin: (tooth: number | undefined) => void;
  onPending: (pin: PendingPin | undefined) => void;
  onPlace: (pin: PendingPin, tooth: number) => void;
  onClear: () => void;
}) {
  const { images, image, loading, pins, pending, active } = props;
  const link = useAttachmentLink(image);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [laser, setLaser] = useState<{ x: number; y: number } | undefined>(undefined);
  const press = useRef<{ x: number; y: number; dragged: boolean } | undefined>(undefined);
  const dragged = useRef(false);

  // Pins are drawn against the image's real rectangle, measured again whenever the stage changes size.
  useEffect(() => {
    const el = stage.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ width: r.width, height: r.height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [image?.id]);

  const rect = containedRect(box, natural);
  const local = (event: { clientX: number; clientY: number }) => {
    const r = stage.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0), box: { width: r?.width ?? 0, height: r?.height ?? 0 } };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const at = local(event);
    press.current = { x: at.x, y: at.y, dragged: false };
    dragged.current = false;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = local(event);
    const held = press.current;
    if (held !== undefined && !held.dragged && Math.hypot(at.x - held.x, at.y - held.y) > DRAG_PX) {
      held.dragged = true;
      dragged.current = true;
    }
    if (held?.dragged === true || event.shiftKey) setLaser({ x: at.x, y: at.y });
    else if (laser !== undefined) setLaser(undefined);
  };
  const endPress = () => {
    press.current = undefined;
    setLaser(undefined);
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    // A drag was the laser pointer, not a tap; a tap on a pin or the picker is not a new pin.
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (event.target instanceof Element && event.target.closest(".xp-pin, .xp-pop") !== null) return;
    const at = local(event);
    const measured = containedRect(at.box, natural);
    setBox(at.box);
    const spot = fractionIn(measured, at.x, at.y);
    if (spot !== undefined) props.onDrop(spot.x, spot.y);
  };

  return (
    <div className="xp-image-inner">
      {images.length > 1 ? (
        <div className="xp-picker" role="group" aria-label="Choose an image">
          {images.map((file) => (
            <button
              key={file.id}
              type="button"
              aria-pressed={file.id === image?.id}
              aria-label={`${file.label ?? "Image"}, ${formatDate(file.created_at)}`}
              onClick={() => {
                props.onChoose(file);
              }}
            >
              <span aria-hidden="true">
                <FileThumb file={file} size={56} />
              </span>
              <span aria-hidden="true">{file.label ?? "Image"}</span>
            </button>
          ))}
        </div>
      ) : null}
      {loading ? (
        <SkeletonRows count={2} tall label="Loading the images" />
      ) : image === undefined ? (
        <p className="xp-muted">No X-ray or photo yet. Add one from the visit bar.</p>
      ) : link.isError ? (
        <ApiErrorNotice title="Couldn't open this image" error={link.error} onRetry={() => void link.refetch()} />
      ) : (
        <>
          <p className="xp-hint">Tap the image to pin a tooth. Press and drag to point.</p>
          <div
            ref={stage}
            className="xp-stage"
            data-testid="explain-stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onPointerCancel={endPress}
            onClick={onClick}
          >
            {link.data === undefined ? null : (
              <img
                src={link.data.url}
                alt={`${image.label ?? "Image"}, ${formatDate(image.created_at)}`}
                draggable={false}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  setNatural({ width: img.naturalWidth, height: img.naturalHeight });
                  const r = stage.current?.getBoundingClientRect();
                  if (r !== undefined) setBox({ width: r.width, height: r.height });
                }}
              />
            )}
            {pins.map((pin, index) => (
              <PinMark
                key={pin.id}
                pin={pin}
                number={index + 1}
                rect={rect}
                active={pin.tooth === active}
                onClick={() => {
                  props.onPin(pin);
                }}
                onHover={props.onHoverPin}
              />
            ))}
            {pending === undefined ? null : (
              <>
                <span className="xp-pin" data-pending="" aria-hidden="true" style={at(rect, pending)}>
                  {pins.length + 1}
                </span>
                <PinPicker number={pins.length + 1} pending={pending} rect={rect} onChange={props.onPending} onPlace={props.onPlace} />
              </>
            )}
            {laser === undefined ? null : <span className="xp-laser" aria-hidden="true" style={{ left: laser.x, top: laser.y }} />}
          </div>
          {pins.length > 0 ? (
            <button type="button" className="xp-btn xp-btn-quiet" onClick={props.onClear}>
              Clear pins
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Where a fraction of the image lands in the stage, in pixels. */
const at = (rect: Rect, point: { x: number; y: number }) => ({ left: rect.left + point.x * rect.width, top: rect.top + point.y * rect.height });

function PinMark({ pin, number, rect, active, onClick, onHover }: { pin: Pin; number: number; rect: Rect; active: boolean; onClick: () => void; onHover: (tooth: number | undefined) => void }) {
  return (
    <button
      type="button"
      className="xp-pin"
      data-active={active || undefined}
      style={at(rect, pin)}
      aria-pressed={active}
      aria-label={`Pin ${String(number)}: tooth ${String(pin.tooth)}${pin.label === "" ? "" : `, ${pin.label}`}`}
      onClick={onClick}
      onPointerEnter={() => {
        onHover(pin.tooth);
      }}
      onPointerLeave={() => {
        onHover(undefined);
      }}
    >
      {number}
      {pin.label === "" ? null : (
        <span className="xp-pin-label" aria-hidden="true">
          {pin.label}
        </span>
      )}
    </button>
  );
}

const QUADRANTS = [1, 2, 3, 4, 5, 6, 7, 8];

/** The small popover for a new pin: an FDI number pad (or a tap on the chart) and an optional short label, typed or spoken. */
function PinPicker({
  number,
  pending,
  rect,
  onChange,
  onPlace,
}: {
  number: number;
  pending: PendingPin;
  rect: Rect;
  onChange: (pin: PendingPin | undefined) => void;
  onPlace: (pin: PendingPin, tooth: number) => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  const latest = useRef(pending);
  useEffect(() => {
    latest.current = pending;
  });
  useEffect(() => {
    first.current?.focus();
  }, []);
  const dictation = useNoteDictation({
    onPhrase: (phrase) => {
      const before = latest.current.label.trim();
      onChange({ ...latest.current, label: (before === "" ? phrase : `${before} ${phrase}`).slice(0, LABEL_MAX) });
    },
    onEnd: () => undefined,
  });
  const tooth = pending.digits.length === 2 ? Number(pending.digits) : undefined;
  const quadrant = pending.digits.length >= 1 ? Number(pending.digits[0]) : undefined;
  const positions = quadrant === undefined ? [] : quadrant <= 4 ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5];
  const place = at(rect, pending);
  // Kept inside the image: it opens to the left of pins on the right half, and above pins on the lower half.
  const style = {
    left: place.left > rect.left + rect.width / 2 ? undefined : place.left + 16,
    right: place.left > rect.left + rect.width / 2 ? Math.max(8, rect.left + rect.width - place.left + 16) : undefined,
    top: place.top > rect.top + rect.height / 2 ? undefined : place.top + 16,
    bottom: place.top > rect.top + rect.height / 2 ? Math.max(8, rect.top + rect.height - place.top + 16) : undefined,
  };

  return (
    <div className="xp-pop" role="group" aria-label={`Pin ${String(number)}`} style={style}>
      <p className="xp-pop-title">
        {tooth === undefined ? `Which tooth? ${pending.digits === "" ? "" : `${pending.digits}_`}` : `Tooth ${String(tooth)}`}
        <span className="xp-muted"> Or tap it on the chart.</span>
      </p>
      <div className="xp-pad" role="group" aria-label={quadrant === undefined ? "Quadrant" : "Tooth position"}>
        {(quadrant === undefined ? QUADRANTS : positions).map((n, index) => (
          <button
            key={n}
            ref={index === 0 ? first : undefined}
            type="button"
            aria-label={quadrant === undefined ? `Quadrant ${String(n)}` : `Tooth ${String(quadrant * 10 + n)}`}
            disabled={tooth !== undefined}
            onClick={() => {
              const digits = `${pending.digits}${String(n)}`;
              if (digits.length === 2 && !isFdi(Number(digits))) return;
              onChange({ ...pending, digits });
            }}
          >
            {n}
          </button>
        ))}
        {pending.digits === "" ? null : (
          <button
            type="button"
            className="xp-pad-clear"
            onClick={() => {
              onChange({ ...pending, digits: "" });
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="xp-pop-label">
        <input
          aria-label="Label (optional)"
          placeholder="Label, such as needs a filling"
          maxLength={LABEL_MAX}
          value={pending.label}
          onChange={(event) => {
            onChange({ ...pending, label: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && tooth !== undefined) onPlace(pending, tooth);
          }}
        />
        {dictation.available ? (
          <button
            type="button"
            className="tc-mic"
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Stop dictating" : "Dictate the label"}
            onClick={() => {
              if (dictation.listening) dictation.stop();
              else dictation.start();
            }}
          >
            <span aria-hidden="true">🎤</span>
          </button>
        ) : null}
      </div>
      <div className="xp-pop-actions">
        <button
          type="button"
          className="xp-btn xp-btn-quiet"
          onClick={() => {
            onChange(undefined);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="xp-btn"
          disabled={tooth === undefined}
          onClick={() => {
            if (tooth !== undefined) onPlace(pending, tooth);
          }}
        >
          Place pin
        </button>
      </div>
    </div>
  );
}
