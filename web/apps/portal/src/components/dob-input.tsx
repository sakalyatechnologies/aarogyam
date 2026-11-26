import { useState, type ComponentProps } from "react";

import { TextInput } from "@sakalya/ui";

/** Digits typed so far, shown as dd/mm/yyyy. */
export function maskDob(text: string): string {
  const d = text.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter((part) => part !== "").join("/");
}

/** `dd/mm/yyyy` to ISO `yyyy-mm-dd`, or "" when it is not a real date. */
export function dobToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (m === null) return "";
  const [, dd = "", mm = "", yyyy = ""] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  const real = date.getUTCFullYear() === Number(yyyy) && date.getUTCMonth() === Number(mm) - 1 && date.getUTCDate() === Number(dd);
  return real ? `${yyyy}-${mm}-${dd}` : "";
}

const isoToDob = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** A date of birth the Indian way (dd/mm/yyyy). The form value stays ISO; it is "" until the date is complete and real. */
export function DobInput({ value, onValueChange, ...rest }: { value: string; onValueChange: (iso: string) => void } & Omit<ComponentProps<typeof TextInput>, "value" | "onChange" | "type">) {
  const [shown, setShown] = useState(isoToDob(value));
  return (
    <TextInput
      {...rest}
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      maxLength={10}
      className="max-w-40"
      value={value !== "" && dobToIso(shown) !== value ? isoToDob(value) : shown}
      onChange={(event) => {
        const next = maskDob(event.currentTarget.value);
        setShown(next);
        onValueChange(dobToIso(next));
      }}
    />
  );
}
