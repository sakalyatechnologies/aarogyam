import { useQuery } from "@tanstack/react-query";
import { CircleCheck, HeartPulse, QrCode } from "lucide-react";
import { useState, type ReactNode, type SubmitEvent } from "react";
import { useSearchParams } from "react-router";

import { apiErrorOf, unwrap, type ArrivePage } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Checkbox, EmptyState, Field, PhoneInput, Skeleton, TextInput, ThemeScope } from "@sakalya/ui";

import { useServices } from "../../clinic.js";
import { MOCKUP_BRAND, mockupTheme } from "../../layout/mockup-theme.js";
import { Chip, IntakeSections } from "../../components/intake/intake-sections.js";
import { PinCodeFields } from "../../components/pin-code-fields.js";
import { arriveBody, arriveProblems, EMPTY_ARRIVE, type ArriveProblems, type ArriveValues } from "./arrive-form.js";

/** The patient's own phone sets "today" for a date of birth, in ISO form. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * `/arrive?k=<key>`: what a patient sees after scanning the clinic's QR code. No sign-in. The clinic comes from
 * the host name (with fake data `?clinic=<host>` names it); the key says the QR is the clinic's own, current one.
 * It sends a request to the desk, never a patient record.
 */
export function ArrivePageRoute() {
  useDocumentTitle("Check in", "Aarogyam");
  const services = useServices();
  const [params] = useSearchParams();
  const host = params.get("clinic") ?? window.location.hostname;
  const key = params.get("k") ?? "";
  const api = services.clinic(host);
  const page = useQuery({
    queryKey: ["arrive-page", host, key],
    queryFn: ({ signal }) => unwrap(api.getArrivePage(key, { signal })),
    enabled: key !== "",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [firstName, setFirstName] = useState<string>();

  let body: ReactNode;
  if (key === "" || (page.isError && apiErrorOf(page.error)?.status === 404)) {
    body = <EmptyState icon={<QrCode className="size-7" />} title="This QR code isn't active" description="Please ask the front desk to check you in." />;
  } else if (page.isPending) {
    body = <Skeleton shape="block" />;
  } else if (page.isError) {
    body = <EmptyState icon={<QrCode className="size-7" />} title="We couldn't reach the clinic" description="Please try again, or ask the front desk." />;
  } else if (firstName !== undefined) {
    body = <Done firstName={firstName} />;
  } else {
    body = (
      <ArriveForm
        page={page.data}
        send={(values, honeypot) => api.sendArrival(arriveBody(key, values, todayIso(), honeypot))}
        lookup={(pin) => api.lookupPincode(pin)}
        onSent={setFirstName}
      />
    );
  }

  return (
    <ThemeScope theme={mockupTheme(MOCKUP_BRAND, "light")} className="min-h-full">
      <div className="mk-app min-h-full">
        <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-on-primary">
              <HeartPulse aria-hidden="true" className="size-6" />
            </span>
            <h1 className="text-xl leading-tight font-extrabold tracking-tight text-text">{page.data === undefined ? "Check in" : `Welcome to ${page.data.clinic_name}`}</h1>
          </div>
          {body}
        </main>
      </div>
    </ThemeScope>
  );
}

function Done({ firstName }: { firstName: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-5 py-10 text-center">
      <CircleCheck aria-hidden="true" className="size-12 text-primary" />
      <h2 className="text-2xl font-bold text-text">Please take a seat</h2>
      <p className="text-base text-muted">{`Thanks, ${firstName}. The front desk will call you.`}</p>
    </div>
  );
}

function toggled(list: readonly string[], code: string): string[] {
  return list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
}

function ArriveForm({
  page,
  send,
  lookup,
  onSent,
}: {
  page: ArrivePage;
  send: (values: ArriveValues, honeypot: string) => ReturnType<ReturnType<typeof useServices>["neutral"]["sendArrival"]>;
  lookup: Parameters<typeof PinCodeFields>[0]["lookup"];
  onSent: (firstName: string) => void;
}) {
  const [values, setValues] = useState<ArriveValues>(EMPTY_ARRIVE);
  const [honeypot, setHoneypot] = useState("");
  const [problems, setProblems] = useState<ArriveProblems>({});
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ArriveValues>) => {
    setValues((now) => ({ ...now, ...patch }));
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = arriveProblems(values, todayIso());
    setProblems(found);
    setFailure(undefined);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    void send(values, honeypot).then((result) => {
      setBusy(false);
      if (result.ok) {
        onSent(values.firstName.trim());
      } else if (result.error.status === 404) {
        setFailure("This QR code isn't active any more. Please ask the front desk to check you in.");
      } else if (result.error.status === 429) {
        setFailure("The desk is very busy right now. Please go to the front desk.");
      } else {
        setFailure(result.error.message);
      }
    });
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5 rounded-card border border-border bg-surface p-5">
      <div className="flex flex-col gap-2" role="group" aria-label="Who is this for">
        <div className="flex flex-wrap gap-2">
          <Chip large label="Me" on={values.forSelf} onToggle={() => { set({ forSelf: true }); }} />
          <Chip large label="My child / family member" on={!values.forSelf} onToggle={() => { set({ forSelf: false }); }} />
        </div>
      </div>
      {values.forSelf ? null : (
        <>
          <Field label="Your name" {...(problems.contactName === undefined ? {} : { error: problems.contactName })} required>
            <TextInput className="h-12 text-base" autoComplete="name" value={values.contactName} onChange={(event) => { set({ contactName: event.currentTarget.value }); }} />
          </Field>
          <div className="flex flex-col gap-2" role="group" aria-label="You are the patient's">
            <p className="text-sm font-medium text-text">You are the patient&apos;s…</p>
            <div className="flex flex-wrap gap-2">
              {page.relations.map((relation) => (
                <Chip large key={relation.code} label={relation.label} on={values.relation === relation.code} onToggle={() => { set({ relation: relation.code }); }} />
              ))}
            </div>
            {problems.relation === undefined ? null : <p role="alert" className="text-sm text-danger-text">{problems.relation}</p>}
          </div>
        </>
      )}
      <Field label={values.forSelf ? "First name" : "Patient's first name"} {...(problems.firstName === undefined ? {} : { error: problems.firstName })} required>
        <TextInput className="h-12 text-base" autoComplete={values.forSelf ? "given-name" : "off"} value={values.firstName} onChange={(event) => { set({ firstName: event.currentTarget.value }); }} />
      </Field>
      <Field label="Last name" hint="Optional.">
        <TextInput className="h-12 text-base" autoComplete={values.forSelf ? "family-name" : "off"} value={values.lastName} onChange={(event) => { set({ lastName: event.currentTarget.value }); }} />
      </Field>
      <Field label="Mobile number" hint="The clinic calls this number if needed." {...(problems.phone === undefined ? {} : { error: problems.phone })} required>
        <PhoneInput className="h-12 text-base" autoComplete="tel-national" value={values.phone} onValueChange={(digits) => { set({ phone: digits }); }} />
      </Field>
      <div className="flex flex-col gap-2" role="group" aria-label="What brings you in">
        <p className="text-sm font-medium text-text">What brings you in?</p>
        <div className="flex flex-wrap gap-2">
          {page.reasons.map((reason) => (
            <Chip large key={reason.code} label={reason.label} on={values.reasons.includes(reason.code)} onToggle={() => { set({ reasons: toggled(values.reasons, reason.code) }); }} />
          ))}
        </div>
        <TextInput className="h-12 text-base" aria-label="Anything else, in a few words" placeholder="Anything else, in a few words" maxLength={200} value={values.reasonText} onChange={(event) => { set({ reasonText: event.currentTarget.value }); }} />
        {problems.reasons === undefined ? null : <p role="alert" className="text-sm text-danger-text">{problems.reasons}</p>}
      </div>

      <details className="rounded-xl border border-border px-4 py-3">
        <summary className="min-h-10 cursor-pointer text-base font-medium text-text">A few more details (optional)</summary>
        <div className="mt-3 flex flex-col gap-5">
          <Field label="Age or date of birth" hint="Like 34, or 12/05/1990." {...(problems.ageOrBirth === undefined ? {} : { error: problems.ageOrBirth })}>
            <TextInput className="h-12 text-base" inputMode="text" autoComplete="off" value={values.ageOrBirth} onChange={(event) => { set({ ageOrBirth: event.currentTarget.value }); }} />
          </Field>
          <div className="flex flex-col gap-2" role="group" aria-label="Sex">
            <p className="text-sm font-medium text-text">Sex</p>
            <div className="flex flex-wrap gap-2">
              {[
                ["female", "Female"],
                ["male", "Male"],
                ["other", "Other"],
              ].map(([code, label]) => (
                <Chip large key={code} label={label ?? ""} on={values.sex === code} onToggle={() => { set({ sex: values.sex === code ? "" : (code ?? "") }); }} />
              ))}
            </div>
          </div>
          <Field label="Email" {...(problems.email === undefined ? {} : { error: problems.email })}>
            <TextInput className="h-12 text-base" type="email" autoComplete="email" value={values.email} onChange={(event) => { set({ email: event.currentTarget.value }); }} />
          </Field>
          <PinCodeFields large compact value={values.pin} onChange={(pin) => { set({ pin }); }} lookup={lookup} {...(problems.pincode === undefined ? {} : { pinError: problems.pincode })} />
          <Field label="Address">
            <TextInput className="h-12 text-base" autoComplete="street-address" placeholder="House, building and street" value={values.line1} onChange={(event) => { set({ line1: event.currentTarget.value }); }} />
          </Field>
          <IntakeSections
            large
            value={values.intake}
            onChange={(intake) => {
              set({ intake });
            }}
            choices={page}
            female={values.sex === "female"}
            mobile={values.phone}
            problems={problems}
          />
          <Checkbox label="Send me appointment reminders on WhatsApp or SMS" checked={values.reminders} onChange={(event) => { set({ reminders: event.currentTarget.checked }); }} />
        </div>
      </details>

      {/* A trap for bots: people never see it, so never fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" name="website" value={honeypot} onChange={(event) => { setHoneypot(event.currentTarget.value); }} />
        </label>
      </div>

      <Checkbox
        label={
          <>
            {`I agree to ${page.clinic_name} keeping my health record to treat me. `}
            <a href={page.notice_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-text underline">
              Privacy notice
            </a>
          </>
        }
        checked={values.consentCare}
        error={problems.consentCare}
        onChange={(event) => { set({ consentCare: event.currentTarget.checked }); }}
      />
      {page.notice_text == null || page.notice_text === "" ? null : (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">Read the notice</summary>
          <p className="mt-2 whitespace-pre-line">{page.notice_text}</p>
        </details>
      )}
      {failure === undefined ? null : (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
          {failure}
        </p>
      )}
      <Button type="submit" className="h-14 text-base" disabled={busy}>
        {busy ? "Sending…" : "Continue"}
      </Button>
    </form>
  );
}
