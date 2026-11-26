import { useRef, useState } from "react";

import type { ApiResult, PincodeInfo } from "@aarogyam/api-client";
import { Field, TextInput } from "@sakalya/ui";

import { useClinic } from "../clinic.js";

/** The three place fields the PIN code fills. Every part stays editable. */
export interface PinValue {
  pincode: string;
  city: string;
  state: string;
}

export const EMPTY_PIN: PinValue = { pincode: "", city: "", state: "" };

/** A PIN code is six digits and never starts with 0. */
export const isPin = (text: string): boolean => /^[1-9]\d{5}$/.test(text);

export type PinLookup = (pin: string) => Promise<ApiResult<PincodeInfo>>;

/** Looks a PIN up through the signed-in clinic's client (the route needs no sign-in, but staff pages already have one). */
export function useClinicPinLookup(): PinLookup {
  const { api } = useClinic();
  return (pin) => api.lookupPincode(pin);
}

type Status = "idle" | "looking" | "found" | "unknown";

/**
 * PIN code, city (the district) and state. Typing the sixth digit looks the PIN up and fills city and
 * state; the person can still change both. The PIN goes to our own server only.
 */
export function PinCodeFields({
  value,
  onChange,
  lookup,
  pinLabel = "PIN code",
  cityLabel = "City or district",
  stateLabel = "State",
  pinError,
  disabled = false,
  large = false,
}: {
  value: PinValue;
  onChange: (next: PinValue) => void;
  lookup: PinLookup;
  pinLabel?: string;
  cityLabel?: string;
  stateLabel?: string;
  pinError?: string | undefined;
  disabled?: boolean;
  /** Bigger touch targets for the public page. */
  large?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const asked = useRef("");

  const ask = (pin: string) => {
    asked.current = pin;
    setStatus("looking");
    void lookup(pin).then((result) => {
      if (asked.current !== pin) return;
      if (result.ok) {
        setStatus("found");
        onChange({ pincode: pin, city: result.value.district, state: result.value.state });
      } else {
        setStatus("unknown");
      }
    });
  };

  const size = large ? "h-12 text-base" : "";
  const hint =
    status === "looking"
      ? "Looking up…"
      : status === "found"
        ? "Filled in from the PIN. Change it if it is wrong."
        : status === "unknown"
          ? "We don't know this PIN. Type the city and state."
          : undefined;

  return (
    <>
      <Field label={pinLabel} {...(pinError === undefined ? {} : { error: pinError })} {...(hint === undefined ? {} : { hint })}>
        <TextInput
          className={size}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          disabled={disabled}
          value={value.pincode}
          onChange={(event) => {
            const pincode = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
            onChange({ ...value, pincode });
            if (isPin(pincode)) {
              ask(pincode);
            } else {
              asked.current = "";
              setStatus("idle");
            }
          }}
        />
      </Field>
      <Field label={cityLabel}>
        <TextInput
          className={size}
          autoComplete="address-level2"
          disabled={disabled}
          value={value.city}
          onChange={(event) => {
            onChange({ ...value, city: event.currentTarget.value });
          }}
        />
      </Field>
      <Field label={stateLabel}>
        <TextInput
          className={size}
          autoComplete="address-level1"
          disabled={disabled}
          value={value.state}
          onChange={(event) => {
            onChange({ ...value, state: event.currentTarget.value });
          }}
        />
      </Field>
    </>
  );
}
