import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CircleCheck, HeartPulse, Mail } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { useSearchParams } from "react-router";

import { apiErrorOf, unwrap, type Booked, type BookingOptions } from "@aarogyam/api-client";
import { formatDateTime, formatTime, useDocumentTitle } from "@aarogyam/app-kit";
import { SignInPanel, useAuth, useAuthState } from "@aarogyam/auth";
import { Button, EmptyState, Field, Select, Skeleton, TextArea, TextInput, ThemeScope } from "@sakalya/ui";

import { useServices } from "../../clinic.js";
import { MOCKUP_BRAND, mockupTheme } from "../../layout/mockup-theme.js";
import { MkCard } from "../../components/mk/index.js";
import { addDays } from "../../lib/time.js";

type Choice = { doctorId: string; date: string; slot: string };

/**
 * The clinic's public booking page (`/book`, on the clinic's host): pick a doctor, a day and a
 * free slot, verify your email with a code, give your name and phone, done. The clinic comes from
 * the host name. With fake data one page serves every clinic, so `?clinic=<host>` names it.
 * The page never learns whether the clinic already knew you.
 */
export function BookPage() {
  useDocumentTitle("Book an appointment", "Aarogyam");
  const services = useServices();
  const [params] = useSearchParams();
  const host = params.get("clinic") ?? window.location.hostname;
  const api = services.clinic(host);
  const options = useQuery({ queryKey: ["book-options", host], queryFn: ({ signal }) => unwrap(api.getBookingOptions({ signal })) });
  const [booked, setBooked] = useState<Booked>();

  let body;
  if (options.isPending) {
    body = <Skeleton shape="block" />;
  } else if (options.isError || !options.data.enabled || options.data.doctors.length === 0) {
    body = (
      <EmptyState
        icon={<CalendarCheck className="size-7" />}
        title="Online booking isn't available"
        description={options.isError && apiErrorOf(options.error)?.status !== 404 ? "We couldn't reach the clinic. Try again in a moment." : "Please call the clinic to book an appointment."}
      />
    );
  } else if (booked !== undefined) {
    body = <Done booked={booked} timeZone={options.data.timezone} />;
  } else {
    body = <Flow host={host} options={options.data} onBooked={setBooked} />;
  }

  return (
    <ThemeScope theme={mockupTheme(MOCKUP_BRAND, "light")} className="min-h-full">
      <div className="mk-app min-h-full">
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary">
              <HeartPulse aria-hidden="true" className="size-6" />
            </span>
            <div className="leading-tight">
              <h1 className="text-xl font-extrabold tracking-tight text-text">{options.data?.clinic_name ?? "Book an appointment"}</h1>
              <p className="text-xs text-muted">Book an appointment online</p>
            </div>
          </div>
          {body}
        </main>
      </div>
    </ThemeScope>
  );
}

function Done({ booked, timeZone }: { booked: Booked; timeZone: string }) {
  return (
    <MkCard>
      <div role="status" className="flex flex-col items-center gap-3 py-6 text-center">
        <CircleCheck aria-hidden="true" className="size-10 text-primary" />
        <h2 style={{ fontSize: 18 }}>{booked.status === "confirmed" ? "Your appointment is confirmed" : "Request received"}</h2>
        <p className="text-sm text-text">
          {formatDateTime(booked.starts_at, timeZone)} with {booked.doctor_name}
        </p>
        <p className="max-w-sm text-sm text-muted">
          {booked.status === "confirmed"
            ? "We've emailed you the details."
            : `${booked.clinic_name} will confirm your appointment, and we'll email you as soon as they do. Until then the time isn't guaranteed.`}
        </p>
      </div>
    </MkCard>
  );
}

function Flow({ host, options, onBooked }: { host: string; options: BookingOptions; onBooked: (booked: Booked) => void }) {
  const services = useServices();
  const api = services.clinic(host);
  const authState = useAuthState();
  const [doctorId, setDoctorId] = useState(options.doctors[0]?.id ?? "");
  const [date, setDate] = useState(options.today);
  const [choice, setChoice] = useState<Choice>();
  const [notice, setNotice] = useState<string>();

  const slots = useQuery({
    queryKey: ["book-slots", host, doctorId, date],
    queryFn: ({ signal }) => unwrap(api.getAvailability(date, doctorId, { signal })),
  });
  const days = Array.from({ length: Math.min(options.horizon_days, 14) }, (_, index) => addDays(options.today, index));
  const picked = choice !== undefined && choice.doctorId === doctorId && choice.date === date ? choice.slot : undefined;

  return (
    <>
      <MkCard title="1 · Choose a time" hint={`${String(options.slot_minutes)}-minute visits`}>
        {notice === undefined ? null : (
          <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {notice}
          </p>
        )}
        <div className="flex flex-col gap-4">
          <Field label="Doctor">
            <Select
              options={options.doctors.map((d) => ({ value: d.id, label: d.specialty == null ? d.name : `${d.name} · ${d.specialty}` }))}
              value={doctorId}
              onValueChange={(value) => {
                setDoctorId(value);
                setChoice(undefined);
              }}
            />
          </Field>
          <div role="group" aria-label="Day" className="flex flex-wrap gap-2">
            {days.map((day) => (
              <button
                key={day}
                type="button"
                className="mk-chipf"
                aria-pressed={day === date}
                onClick={() => {
                  setDate(day);
                  setChoice(undefined);
                }}
              >
                {dayLabel(day, day === options.today)}
              </button>
            ))}
          </div>
          {slots.isPending ? (
            <Skeleton shape="block" />
          ) : slots.isError ? (
            <p role="alert" className="text-sm text-danger-text">
              We couldn't load the times. Try another day or come back in a moment.
            </p>
          ) : slots.data.slots.length === 0 ? (
            <p className="text-sm text-muted">No free times on this day. Try another day.</p>
          ) : (
            <div role="group" aria-label="Free times" className="flex flex-wrap gap-2">
              {slots.data.slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className="mk-chipf"
                  aria-pressed={slot === picked}
                  onClick={() => {
                    setNotice(undefined);
                    setChoice({ doctorId, date, slot });
                  }}
                >
                  {formatTime(slot, options.timezone)}
                </button>
              ))}
            </div>
          )}
        </div>
      </MkCard>

      {picked === undefined ? null : authState.status !== "signed_in" ? (
        <MkCard title="2 · Verify your email" hint="We'll send a one-time code. No password needed.">
          {authState.status === "loading" ? <Skeleton shape="block" /> : <PatientSignIn />}
        </MkCard>
      ) : (
        <Details
          host={host}
          doctorName={options.doctors.find((d) => d.id === doctorId)?.name ?? ""}
          email={authState.user.email}
          slot={picked}
          timeZone={options.timezone}
          practitionerId={doctorId}
          onBooked={onBooked}
          onTaken={(message) => {
            setNotice(message);
            setChoice(undefined);
            void slots.refetch();
          }}
        />
      )}
    </>
  );
}

/**
 * Email, then a code, for someone who isn't staff. Development has no email service, so there the
 * address is taken as given; a deployed server only accepts an email Supabase verified with a code.
 */
function PatientSignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  if (auth.kind !== "dev") {
    return <SignInPanel auth={auth} emailLabel="Your email" />;
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          setError("Enter a valid email address.");
          return;
        }
        auth.signInAsNew({ displayName: "Patient", email: email.trim() });
      }}
    >
      <p className="text-sm text-muted">Development: no code is sent; the address is used as typed.</p>
      <Field label="Your email" error={error} required>
        <TextInput type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.currentTarget.value); }} />
      </Field>
      <Button type="submit">Continue</Button>
    </form>
  );
}

function Details({
  host,
  doctorName,
  email,
  slot,
  timeZone,
  practitionerId,
  onBooked,
  onTaken,
}: {
  host: string;
  doctorName: string;
  email: string | undefined;
  slot: string;
  timeZone: string;
  practitionerId: string;
  onBooked: (booked: Booked) => void;
  onTaken: (message: string) => void;
}) {
  const services = useServices();
  const api = services.clinic(host);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (fullName.trim() === "" || phone.trim() === "") {
      setError("Enter your name and a phone number the clinic can reach you on.");
      return;
    }
    setBusy(true);
    setError(undefined);
    void api
      .createOnlineBooking({
        starts_at: slot,
        practitioner_id: practitionerId,
        full_name: fullName.trim(),
        phone: phone.trim(),
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
      })
      .then((result) => {
        setBusy(false);
        if (result.ok) {
          onBooked(result.value);
        } else if (result.error.status === 409 && result.error.message.includes("no longer available")) {
          onTaken("Sorry, someone just took that time. Please choose another.");
        } else {
          setError(result.error.message);
        }
      });
  };

  return (
    <MkCard title="2 · Your details" hint={`${formatDateTime(slot, timeZone)} with ${doctorName}`}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Mail aria-hidden="true" className="size-4" /> Verified: {email ?? "your email"}
        </p>
        <Field label="Full name" required>
          <TextInput autoComplete="name" value={fullName} onChange={(event) => { setFullName(event.currentTarget.value); }} />
        </Field>
        <Field label="Phone" hint="The clinic may call to confirm." required>
          <TextInput type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => { setPhone(event.currentTarget.value); }} />
        </Field>
        <Field label="Reason for the visit" hint="Optional, a few words.">
          <TextArea value={reason} maxLength={200} onChange={(event) => { setReason(event.currentTarget.value); }} />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Booking…" : "Request appointment"}
        </Button>
      </form>
    </MkCard>
  );
}

/** `Today`, or `Mon 5 Oct`. */
function dayLabel(iso: string, today: boolean): string {
  if (today) {
    return "Today";
  }
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
