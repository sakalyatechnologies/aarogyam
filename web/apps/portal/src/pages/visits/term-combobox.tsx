import { useId, useState } from "react";

import type { DentalTerm, DentalTermKind } from "@aarogyam/api-client";
import { useFieldControl } from "@sakalya/ui";

import { hasLabel, matchTerms } from "./odontogram/terms.js";
import "./term-combobox.css";

export interface TermComboboxProps {
  kind: DentalTermKind;
  /** The chart's list: seeded terms, then the clinic's own. Filtered here as the clinician types. */
  terms: readonly DentalTerm[];
  value: DentalTerm | undefined;
  onChange: (term: DentalTerm | undefined) => void;
  /** Saves a new term for the clinic and resolves with it; undefined hides "Add new". */
  onAdd: ((label: string) => Promise<DentalTerm>) | undefined;
}

type Option = { kind: "term"; term: DentalTerm } | { kind: "add"; label: string };

/** A dropdown with type-ahead ("Z" offers Zirconia) and "Add new", which saves the term for the clinic. Inside a `Field` for its label. */
export function TermCombobox({ kind, terms, value, onChange, onAdd }: TermComboboxProps) {
  const { props: control } = useFieldControl({});
  const listId = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const typed = text.trim();
  const shown = typed === value?.label ? "" : typed;
  const options: Option[] = [
    ...matchTerms(terms, kind, shown).map((term): Option => ({ kind: "term", term })),
    ...(onAdd !== undefined && typed !== "" && !hasLabel(terms, kind, typed) ? [{ kind: "add", label: typed } satisfies Option] : []),
  ];
  const current = Math.min(active, Math.max(options.length - 1, 0));

  const pick = (option: Option | undefined) => {
    if (option === undefined) return;
    setError(undefined);
    if (option.kind === "term") {
      onChange(option.term);
      setText(option.term.label);
      setOpen(false);
      return;
    }
    if (onAdd === undefined) return;
    setAdding(true);
    onAdd(option.label)
      .then((term) => {
        onChange(term);
        setText(term.label);
        setOpen(false);
      })
      .catch(() => {
        setError(`Couldn't add "${option.label}". Please try again.`);
      })
      .finally(() => {
        setAdding(false);
      });
  };

  return (
    <div className="odo-combo">
      <input
        {...control}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length > 0 ? `${listId}-${String(current)}` : undefined}
        autoComplete="off"
        className="odo-combo-input"
        placeholder={kind === "material" ? "Type to find a material" : "Type to find a procedure"}
        value={text}
        disabled={adding}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          // Leaving the box with text that names nothing keeps the last choice.
          if (typed === "") onChange(undefined);
          else setText(value?.label ?? "");
        }}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(Math.min(current + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            pick(options[current]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label={kind === "material" ? "Materials" : "Procedures"} className="odo-combo-list">
          {options.map((option, index) => (
            <li
              key={option.kind === "term" ? option.term.id : "add"}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={index === current}
              onMouseDown={(event) => {
                // Keep focus in the input so blur doesn't close the list before the pick.
                event.preventDefault();
              }}
              onMouseMove={() => {
                setActive(index);
              }}
              onClick={() => {
                pick(option);
              }}
            >
              {option.kind === "term" ? (
                <>
                  {option.term.label}
                  {option.term.own ? <small> · this clinic</small> : null}
                </>
              ) : (
                <b>{`Add "${option.label}"`}</b>
              )}
            </li>
          ))}
          {options.length === 0 ? (
            <li role="presentation" className="odo-muted">
              Nothing matches.
            </li>
          ) : null}
        </ul>
      ) : null}
      {error === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
