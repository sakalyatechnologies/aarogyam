import { useState, type ReactNode, type SubmitEvent } from "react";

import { apiErrorOf, type ClinicSettings } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { useToast } from "@sakalya/ui";

import { Initials, MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useClinicSettings, useUpdateClinicSettings } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

/** Settings, "Clinic profile": the owner edits the clinic's details; everyone else sees who they are signed in as. */
export function ProfileTab() {
  const { session, can } = useClinic();
  if (!can("settings.manage")) {
    return (
      <MkCard title="Your account" hint="Signed in as">
        <div className="mk-pname" style={{ padding: "8px 0" }}>
          <Initials name={session.user.display_name} size="md" />
          <span>
            <b style={{ display: "block" }}>{session.user.display_name}</b>
            <span className="mk-hint">Only the clinic owner can change the clinic profile.</span>
          </span>
        </div>
      </MkCard>
    );
  }
  return (
    <MkCard title="Clinic profile" hint="Shown on your website, bills and prescriptions">
      <ProfilePanel />
    </MkCard>
  );
}

function ProfilePanel() {
  const settings = useClinicSettings();
  if (settings.isPending) {
    return <SkeletonRows count={6} label="Loading settings" />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load the clinic's settings" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  return <ProfileForm settings={settings.data} />;
}

interface ProfileValues {
  name: string;
  legal_name: string;
  gstin: string;
  phone: string;
  upi_id: string;
  prescription_footer: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

type Key = keyof ProfileValues;

function toValues(settings: ClinicSettings): ProfileValues {
  return {
    name: settings.name,
    legal_name: settings.legal_name ?? "",
    gstin: settings.gstin ?? "",
    phone: settings.phone ?? "",
    upi_id: settings.upi_id ?? "",
    prescription_footer: settings.prescription_footer ?? "",
    line1: settings.address.line1 ?? "",
    line2: settings.address.line2 ?? "",
    city: settings.address.city ?? "",
    state: settings.address.state ?? "",
    pincode: settings.address.pincode ?? "",
  };
}

/** One labelled group of fields: its title and hint beside the fields on wide screens, above them on a phone. */
function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={`profile-section-${id}`} className="st-section">
      <div className="st-section-head">
        <h3 id={`profile-section-${id}`} className="st-legend">
          {title}
        </h3>
        <p className="st-section-hint">{hint}</p>
      </div>
      <div className="st-fields">{children}</div>
    </div>
  );
}

function ProfileForm({ settings }: { settings: ClinicSettings }) {
  const update = useUpdateClinicSettings();
  const toast = useToast();
  const [form, setForm] = useState<ProfileValues>(() => toValues(settings));
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Key, string>>>({});

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setFieldErrors({});
    update.mutate(
      {
        name: form.name,
        legal_name: form.legal_name,
        gstin: form.gstin,
        phone: form.phone,
        upi_id: form.upi_id,
        prescription_footer: form.prescription_footer,
        address: { line1: form.line1, line2: form.line2, city: form.city, state: form.state, pincode: form.pincode },
      },
      {
        onSuccess: (saved) => {
          setForm(toValues(saved));
          toast.show({ title: "Settings saved", tone: "success" });
        },
        onError: (thrown) => {
          const apiError = apiErrorOf(thrown);
          const key = apiError?.field;
          if (apiError !== undefined && key !== undefined && isProfileField(key)) {
            setFieldErrors({ [key]: apiError.message });
          } else {
            setError(apiError?.message ?? "Couldn't save the clinic's settings. Please try again.");
          }
        },
      },
    );
  };

  const input = (key: Key, label: string, extra: { mono?: boolean; span?: "wide" | "third"; placeholder?: string; multiline?: boolean } = {}) => {
    const props = {
      id: `profile-${key}`,
      className: `mk-tin ${extra.mono === true ? "mk-mono" : ""}`,
      placeholder: extra.placeholder,
      "aria-invalid": fieldErrors[key] !== undefined,
      value: form[key],
      onChange: (event: { target: { value: string } }) => {
        setForm((prev) => ({ ...prev, [key]: event.target.value }));
      },
    };
    return (
      <div className={`st-field ${extra.span === undefined ? "" : `st-${extra.span}`}`}>
        <label className="mk-flabel" htmlFor={props.id}>
          {label}
        </label>
        {extra.multiline === true ? <textarea rows={2} {...props} /> : <input {...props} />}
        {fieldErrors[key] === undefined ? null : (
          <p role="alert" className="st-field-error">
            {fieldErrors[key]}
          </p>
        )}
      </div>
    );
  };
  return (
    <form onSubmit={onSubmit} className="st-form">
      <Section id="identity" title="Identity" hint="The name patients see, and the registered name for bills.">
        {input("name", "Clinic name")}
        {input("legal_name", "Legal name")}
      </Section>
      <Section id="contact" title="Contact and address" hint="Printed on letterheads and shown on your website.">
        {input("phone", "Phone")}
        {input("line1", "Address", { span: "wide", placeholder: "House, building and street" })}
        {input("line2", "Address line 2", { span: "wide", placeholder: "Area or landmark" })}
        {input("city", "City", { span: "third" })}
        {input("state", "State", { span: "third" })}
        {input("pincode", "PIN code", { span: "third" })}
      </Section>
      <Section id="billing" title="Billing and tax" hint="Used on bills, receipts and UPI payment links.">
        {input("gstin", "GSTIN", { mono: true })}
        {input("upi_id", "UPI ID", { placeholder: "clinic@okicici" })}
      </Section>
      <Section id="prescriptions" title="Prescriptions" hint="A line printed at the bottom of every prescription.">
        {input("prescription_footer", "Prescription footer", { span: "wide", multiline: true })}
      </Section>
      {error === undefined ? null : (
        <p role="alert" className="mk-pill down st-form-error">
          {error}
        </p>
      )}
      <div className="st-actions">
        <button type="submit" className="mk-btn mk-btn-primary" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function isProfileField(key: string): key is Key {
  return key in { name: 0, legal_name: 0, gstin: 0, phone: 0, upi_id: 0, prescription_footer: 0, line1: 0, line2: 0, city: 0, state: 0, pincode: 0 };
}
