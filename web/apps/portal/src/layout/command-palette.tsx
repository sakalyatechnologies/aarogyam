import { Pill, Receipt, Search, UserRound } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { formatRupees } from "@aarogyam/app-kit";

import { useClinic } from "../clinic.js";
import { useInvoices } from "../pages/billing/queries.js";
import { usePatients } from "../queries.js";
import { patientPath } from "../lib/patients.js";
import { usePatientPeek } from "./peek.js";

export interface PalettePage {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
}

interface Entry {
  key: string;
  group: "Pages" | "Patients" | "Prescriptions" | "Bills";
  label: string;
  hint?: string | undefined;
  icon: ReactNode;
  run: () => void;
}

const GROUPS = ["Pages", "Patients", "Prescriptions", "Bills"] as const;

/** Pages whose label contains every word typed. */
export function matchPages(pages: readonly PalettePage[], text: string): PalettePage[] {
  const words = text.toLowerCase().split(/\s+/).filter((word) => word !== "");
  return pages.filter((page) => words.every((word) => page.label.toLowerCase().includes(word)));
}

/**
 * The ⌘K command palette: pages, patients (opens the quick look), a patient's prescriptions and
 * bills. Typing never reaches a URL; opening an entry navigates by id.
 */
export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: readonly PalettePage[] }) {
  // Mounted only while open, so every opening starts with an empty box.
  return open ? <PaletteBody onClose={onClose} pages={pages} /> : null;
}

function PaletteBody({ onClose, pages }: { onClose: () => void; pages: readonly PalettePage[] }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const peek = usePatientPeek();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const canPatients = can("patients.read");
  const canBills = can("billing.read");

  useEffect(() => {
    inputRef.current?.focus();
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      before?.focus();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const searching = canPatients && query.length >= 2;
  const patients = usePatients(query, searching);
  const invoices = useInvoices({}, canBills && query.length >= 2);

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => {
      onClose();
      void navigate(href);
    };
    const out: Entry[] = matchPages(pages, text).map((page) => ({ key: `page-${page.id}`, group: "Pages", label: page.label, icon: page.icon, run: go(page.href) }));
    if (query.length >= 2) {
      const found = (patients.data?.items ?? []).slice(0, 5);
      for (const patient of found) {
        out.push({
          key: `patient-${patient.id}`,
          group: "Patients",
          label: patient.full_name,
          hint: patient.number,
          icon: <UserRound aria-hidden="true" />,
          run: () => {
            onClose();
            peek({ id: patient.id, name: patient.full_name, number: patient.number });
          },
        });
      }
      if (can("clinical.read")) {
        for (const patient of found.slice(0, 3)) {
          out.push({
            key: `rx-${patient.id}`,
            group: "Prescriptions",
            label: `Prescriptions for ${patient.full_name}`,
            hint: patient.number,
            icon: <Pill aria-hidden="true" />,
            run: go(`${patientPath(patient)}?tab=prescriptions`),
          });
        }
      }
      const lower = query.toLowerCase();
      for (const invoice of (invoices.data?.items ?? [])
        .filter((item) => (item.number ?? "").toLowerCase().includes(lower) || item.patient.name.toLowerCase().includes(lower))
        .slice(0, 5)) {
        out.push({
          key: `bill-${invoice.id}`,
          group: "Bills",
          label: `${invoice.number ?? "Draft bill"} · ${invoice.patient.name}`,
          hint: formatRupees(invoice.total_paise),
          icon: <Receipt aria-hidden="true" />,
          run: go(`/billing/invoices/${invoice.id}`),
        });
      }
    }
    return out.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  }, [pages, text, query, patients.data, invoices.data, can, navigate, onClose, peek]);

  const current = Math.min(active, Math.max(entries.length - 1, 0));
  useEffect(() => {
    const el = document.getElementById(`${listId}-${String(current)}`);
    if (el !== null && "scrollIntoView" in el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [current, listId]);

  const busy = query.length >= 2 && (patients.isFetching || invoices.isFetching || query !== text.trim());
  return (
    <div
      className="mk-palette-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="mk-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(Math.min(current + 1, entries.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            entries[current]?.run();
          } else if (event.key === "Tab") {
            event.preventDefault();
          }
        }}
      >
        <label className="mk-palette-in">
          <Search aria-hidden="true" />
          <span className="mk-sr">Search patients, bills, prescriptions and pages</span>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={entries.length === 0 ? undefined : `${listId}-${String(current)}`}
            autoComplete="off"
            placeholder="Search patients, bills, prescriptions, pages…"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setActive(0);
            }}
          />
          <kbd aria-hidden="true">esc</kbd>
        </label>
        <ul id={listId} role="listbox" aria-label="Results" className="mk-palette-list">
          {entries.map((entry, index) => (
            <li key={entry.key} role="presentation">
              {index === 0 || entries[index - 1]?.group !== entry.group ? <div className="mk-palette-g">{entry.group}</div> : null}
              <button
                type="button"
                id={`${listId}-${String(index)}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === current}
                onMouseMove={() => {
                  setActive(index);
                }}
                onClick={entry.run}
              >
                <span className="mk-palette-ico">{entry.icon}</span>
                <span>{entry.label}</span>
                {entry.hint === undefined ? null : <small>{entry.hint}</small>}
              </button>
            </li>
          ))}
          {entries.length === 0 ? (
            <li role="presentation" className="mk-none">
              {busy ? "Searching…" : query.length < 2 ? "Type at least 2 letters to search patients and bills." : "Nothing matches."}
            </li>
          ) : busy ? (
            <li role="presentation" className="mk-none">
              Searching…
            </li>
          ) : null}
        </ul>
        <p className="mk-palette-foot">
          Open this search anywhere with <kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>⌘</kbd> + <kbd>K</kbd>. <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open.
        </p>
      </div>
    </div>
  );
}
