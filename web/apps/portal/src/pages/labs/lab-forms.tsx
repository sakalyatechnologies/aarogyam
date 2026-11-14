import { useState } from "react";

import { apiErrorOf, type LabContact, type LabContactChannel, type LabVendor, type LabVendorKind } from "@aarogyam/api-client";
import { Button, Checkbox, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { useSaveLabContact, useSaveLabVendor } from "./queries.js";
import { WORK_TYPES } from "./stages.js";

export const KIND_LABEL: Readonly<Record<LabVendorKind, string>> = {
  dental_lab: "Dental lab",
  pathology: "Pathology",
  radiology: "Radiology",
  other: "Other",
};
const KINDS = (["dental_lab", "pathology", "radiology", "other"] as const).map((value) => ({ value, label: KIND_LABEL[value] }));
const CHANNELS: readonly { value: LabContactChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone call" },
];

/** Adds a lab, or changes one. Needs `labs.write`. */
export function LabDialog({ lab, open, onClose }: { lab: LabVendor | undefined; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const save = useSaveLabVendor();
  const [name, setName] = useState(lab?.name ?? "");
  const [kind, setKind] = useState<LabVendorKind>(lab?.kind ?? "dental_lab");
  const [phone, setPhone] = useState(lab?.phone ?? "");
  const [email, setEmail] = useState(lab?.email ?? "");
  const [address, setAddress] = useState(lab?.address ?? "");
  const [note, setNote] = useState(lab?.note ?? "");
  const [city, setCity] = useState(lab?.city ?? "");
  const [workTypes, setWorkTypes] = useState<string[]>(lab?.work_types ?? []);
  const [draftType, setDraftType] = useState("");
  const [turnaround, setTurnaround] = useState(lab?.turnaround_days == null ? "" : String(lab.turnaround_days));
  const [error, setError] = useState<string>();

  const addType = () => {
    const next = draftType.trim();
    if (next !== "" && !workTypes.some((t) => t.toLowerCase() === next.toLowerCase())) setWorkTypes([...workTypes, next]);
    setDraftType("");
  };
  const submit = () => {
    setError(undefined);
    if (name.trim() === "") {
      setError("Enter the lab's name.");
      return;
    }
    const days = turnaround.trim() === "" ? null : Number(turnaround);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 90)) {
      setError("Turnaround is 1 to 90 days.");
      return;
    }
    const pending = draftType.trim();
    const types = pending !== "" && !workTypes.some((t) => t.toLowerCase() === pending.toLowerCase()) ? [...workTypes, pending] : workTypes;
    save.mutate(
      {
        id: lab?.id,
        values: { name: name.trim(), kind, phone: phone.trim(), email: email.trim(), address: address.trim(), note: note.trim(), city: city.trim() === "" ? null : city.trim(), work_types: types, turnaround_days: days },
      },
      {
        onSuccess: (saved) => {
          toast.show({ title: lab === undefined ? `${saved.name} added` : `${saved.name} saved`, tone: "success" });
          onClose();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't save this lab. Please try again.");
        },
      },
    );
  };
  const text = (value: string, set: (next: string) => void) => ({
    value,
    onChange: (event: { currentTarget: { value: string } }) => {
      set(event.currentTarget.value);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={lab === undefined ? "Add a lab" : "Edit lab"}
      description="Labs you send work to. Add the people there once it's saved."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save lab"}
          </Button>
        </>
      }
    >
      <div className="lb-form">
        <Field label="Lab name" required>
          <TextInput maxLength={120} {...text(name, setName)} />
        </Field>
        <div className="lb-two">
          <Field label="Kind">
            <Select options={KINDS} value={kind} onValueChange={setKind} />
          </Field>
          <Field label="Phone">
            <TextInput type="tel" maxLength={20} {...text(phone, setPhone)} />
          </Field>
        </div>
        <Field label="Email" hint="Reminders are emailed here when a contact has none">
          <TextInput type="email" {...text(email, setEmail)} />
        </Field>
        <Field label="Area or address">
          <TextInput maxLength={300} {...text(address, setAddress)} />
        </Field>
        <div className="lb-two">
          <Field label="City">
            <TextInput maxLength={80} {...text(city, setCity)} />
          </Field>
          <Field label="Turnaround (days)" hint="1 to 90">
            <TextInput inputMode="numeric" maxLength={2} {...text(turnaround, setTurnaround)} />
          </Field>
        </div>
        <Field label="Work types" hint="What this lab makes. Press Enter or Add after each">
          <div className="lb-two">
            <TextInput
              list="lb-work-type-options"
              maxLength={60}
              {...text(draftType, setDraftType)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addType();
                }
              }}
            />
            <Button variant="secondary" onClick={addType}>
              Add type
            </Button>
          </div>
        </Field>
        <datalist id="lb-work-type-options">
          {WORK_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {workTypes.length === 0 ? null : (
          <ul className="lb-items" aria-label="Work types chosen">
            {workTypes.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  className="lb-btn"
                  aria-label={`Remove ${t}`}
                  onClick={() => {
                    setWorkTypes(workTypes.filter((x) => x !== t));
                  }}
                >
                  {t} ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Note">
          <TextInput maxLength={500} {...text(note, setNote)} />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="lb-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Adds a person at a lab, or changes one. Needs `labs.write`. */
export function ContactDialog({ lab, contact, open, onClose }: { lab: LabVendor; contact: LabContact | undefined; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const save = useSaveLabContact();
  const [name, setName] = useState(contact?.name ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [whatsapp, setWhatsapp] = useState(contact?.whatsapp ?? false);
  const [channel, setChannel] = useState<LabContactChannel>(contact?.preferred_channel ?? "phone");
  const [error, setError] = useState<string>();

  const submit = () => {
    setError(undefined);
    if (name.trim() === "") {
      setError("Enter the person's name.");
      return;
    }
    save.mutate(
      {
        vendorId: lab.id,
        id: contact?.id,
        values: { name: name.trim(), role: role.trim(), phone: phone.trim(), email: email.trim(), whatsapp, preferred_channel: channel },
      },
      {
        onSuccess: (saved) => {
          toast.show({ title: contact === undefined ? `${saved.name} added to ${lab.name}` : `${saved.name} saved`, tone: "success" });
          onClose();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't save this contact. Please try again.");
        },
      },
    );
  };
  const text = (value: string, set: (next: string) => void) => ({
    value,
    onChange: (event: { currentTarget: { value: string } }) => {
      set(event.currentTarget.value);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={contact === undefined ? `Add a contact at ${lab.name}` : `Edit ${contact.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save contact"}
          </Button>
        </>
      }
    >
      <div className="lb-form">
        <div className="lb-two">
          <Field label="Name" required>
            <TextInput maxLength={120} {...text(name, setName)} />
          </Field>
          <Field label="Role">
            <TextInput maxLength={60} {...text(role, setRole)} />
          </Field>
        </div>
        <div className="lb-two">
          <Field label="Phone">
            <TextInput type="tel" maxLength={20} {...text(phone, setPhone)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" {...text(email, setEmail)} />
          </Field>
        </div>
        <Field label="Best way to reach them">
          <Select options={CHANNELS} value={channel} onValueChange={setChannel} />
        </Field>
        <Checkbox
          label="This number is on WhatsApp"
          checked={whatsapp}
          onChange={(event) => {
            setWhatsapp(event.currentTarget.checked);
          }}
        />
        {error === undefined ? null : (
          <p role="alert" className="lb-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
