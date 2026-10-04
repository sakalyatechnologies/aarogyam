import { CalendarCheck, HeartPulse, IndianRupee, ListOrdered, Pill, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { useAuthState } from "@aarogyam/auth";
import { Button, Card, Link, Skeleton } from "@sakalya/ui";

/**
 * The root route, on any host: a signed-in person continues straight to their clinic; signed out,
 * they see the landing page instead of being bounced to `/sign-in` (the product's front door).
 */
export function RootPage() {
  const state = useAuthState();
  if (state.status === "loading") {
    return (
      <div className="p-6" role="status" aria-label="Loading">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (state.status === "signed_in") {
    return <Navigate to="/today" replace />;
  }
  return <LandingPage />;
}

interface Highlight {
  icon: ReactNode;
  title: string;
  body: string;
}

const HIGHLIGHTS: readonly Highlight[] = [
  {
    icon: <UsersRound aria-hidden="true" className="size-6" />,
    title: "One record per patient",
    body: "Search by name, clinic number or phone; everyone on the team sees the same history, allergies and files.",
  },
  {
    icon: <CalendarCheck aria-hidden="true" className="size-6" />,
    title: "Calendar, queue and chairs",
    body: "Book appointments, call patients in from the waiting room, and see who's in which chair right now.",
  },
  {
    icon: <ListOrdered aria-hidden="true" className="size-6" />,
    title: "Visit notes and treatment plans",
    body: "Vitals, clinical notes, procedures and the dental chart, signed and kept together with the visit.",
  },
  {
    icon: <Pill aria-hidden="true" className="size-6" />,
    title: "Prescriptions with safety checks",
    body: "Allergy alerts before you issue, a printed layout with a QR code patients and pharmacies can verify.",
  },
  {
    icon: <IndianRupee aria-hidden="true" className="size-6" />,
    title: "Billing with GST, done right",
    body: "Price lists, GST per line, a number per financial year, and payments that reconcile to the rupee.",
  },
];

/**
 * The signed-out front door: shown at `/` on the portal before sign-in, on any host (a clinic's
 * subdomain or the neutral one). Sign in and Register your clinic are the only two ways in.
 */
export function LandingPage() {
  useDocumentTitle("Aarogyam", "Clinic and patient health platform");
  const navigate = useNavigate();
  return (
    <main className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-on-primary">
            <HeartPulse aria-hidden="true" className="size-5" />
          </span>
          <p className="text-lg font-extrabold tracking-tight text-text">Aarogyam</p>
        </div>
        <Link
          href="/sign-in"
          className="rounded-xl px-3 py-2 text-sm font-semibold text-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-5xl px-4 pt-6 pb-14 sm:px-6 sm:pt-10">
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-[0.14em] text-primary-text uppercase">For multi-specialty clinics</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-text sm:text-5xl">Run your clinic's whole day in one place</h1>
          <p className="mt-4 text-lg text-muted">
            Patients, appointments, the waiting room, visit notes, prescriptions and billing — one portal for the owner, the doctors and the
            front desk, each seeing only what their role allows.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              onClick={() => {
                void navigate("/register");
              }}
            >
              Register your clinic
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void navigate("/sign-in");
              }}
            >
              Sign in
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">Already have an invitation? Open the link from your clinic's email instead.</p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map((highlight) => (
            <Card key={highlight.title}>
              <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">{highlight.icon}</span>
              <h2 className="mt-4 text-base font-bold text-text">{highlight.title}</h2>
              <p className="mt-1.5 text-sm text-muted">{highlight.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted sm:px-6">Aarogyam · by Sakalya Technologies</div>
      </footer>
    </main>
  );
}
