/** Inline editing: text that becomes editable on click in the portal's preview, and picture slots. */

import { createContext, useContext, type ElementType, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

import type { EditApi, PhotoKind, SitePhoto } from "./types.js";

const EditContext = createContext<EditApi | null>(null);

export const EditProvider = EditContext.Provider;

/** The editing callbacks, or `null` on the live site. */
export function useEdit(): EditApi | null {
  return useContext(EditContext);
}

export interface TxtProps {
  /** Where the text is stored, such as `hero.headline`; reported to `setText`. */
  path: string;
  /** What the owner wrote; empty means the default shows. */
  value: string;
  /** The wording shown when the owner has written nothing. */
  fallback: string;
  as?: ElementType;
  className?: string;
  /** Paragraphs separated by blank lines (about text, bios, reviews). */
  multiline?: boolean;
  /** Names the field for screen readers while editing. */
  label: string;
}

function paragraphsOf(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== "");
}

/** Text that the owner can click and type over; plain text on the live site. */
export function Txt({ path, value, fallback, as, className, multiline = false, label }: TxtProps) {
  const edit = useEdit();
  const Tag: ElementType = as ?? "span";
  const shown = value.trim() === "" ? fallback : value;
  if (edit === null) {
    if (multiline) {
      return (
        <div className={className}>
          {paragraphsOf(shown).map((p, i) => (
            <p key={`${String(i)}-${p.slice(0, 12)}`}>{p}</p>
          ))}
        </div>
      );
    }
    return <Tag className={className}>{shown}</Tag>;
  }
  const commit = (element: HTMLElement) => {
    const next = (element.innerText || element.textContent || "").replaceAll(String.fromCharCode(160), " ").trim();
    const next2 = multiline ? next.replace(/\n{3,}/g, "\n\n") : next.replace(/\s+/g, " ");
    // Typing nothing, or the default wording back, keeps the default.
    const unchanged = next2 === shown || (next2 === fallback && value.trim() === "");
    if (!unchanged) {
      edit.setText(path, next2 === fallback ? "" : next2);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && !multiline) {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  };
  return (
    <Tag
      key={`${path}:${value}`}
      className={`${className ?? ""} cs-editable${value.trim() === "" ? " is-default" : ""}${multiline ? " is-multiline" : ""}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline={multiline}
      spellCheck
      onBlur={(event: FocusEvent<HTMLElement>) => {
        commit(event.currentTarget);
      }}
      onKeyDown={onKeyDown}
    >
      {shown}
    </Tag>
  );
}

export interface PhotoSlotProps {
  kind: PhotoKind;
  photo: SitePhoto | null | undefined;
  /** Shown when there is no picture. */
  fallback?: ReactNode;
  className?: string;
  assetBase: string;
  /** The first picture on the page loads at once; the rest wait until they scroll near. */
  eager?: boolean;
  /** Names the slot for the edit button. */
  label: string;
  children?: never;
}

/** A picture, or a placeholder with a button to add one while editing. */
export function PhotoSlot({ kind, photo, fallback, className, assetBase, eager = false, label }: PhotoSlotProps) {
  const edit = useEdit();
  const picture =
    photo === null || photo === undefined ? null : (
      <img
        src={`${assetBase}${photo.url}`}
        alt={photo.alt ?? ""}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        {...(eager ? { fetchPriority: "high" as const } : {})}
      />
    );
  if (edit === null) {
    return picture === null && fallback === undefined ? null : <div className={className}>{picture ?? fallback}</div>;
  }
  return (
    <div className={`${className ?? ""} cs-slot`}>
      {picture ?? fallback}
      <button
        type="button"
        className="cs-slot-btn"
        onClick={() => {
          edit.pickPhoto(kind, photo ?? null);
        }}
      >
        {photo === null || photo === undefined ? `Add ${label}` : `Change ${label}`}
      </button>
    </div>
  );
}
