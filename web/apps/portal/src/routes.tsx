import { Navigate, Outlet, useParams, type RouteObject } from "react-router";

import { lazyPage, RouterLinks } from "@aarogyam/app-kit";

import { RequireCan } from "./components/require-can.js";
import { ClinicGate, RequireAuth } from "./layout/portal-layout.js";

/** Shown while the first page's code loads. */
const loading = <div className="p-6" role="status" aria-label="Loading" />;

/** Old per-patient prescriptions address: the patient's Rx tab now holds that list. */
function PatientRxRedirect() {
  const { patientId } = useParams();
  return <Navigate to={`/patients/${patientId ?? ""}?tab=prescriptions`} replace />;
}

/** Paths carry IDs only: never names, phones or search terms. The invite token rides in the fragment. */
export const routes: RouteObject[] = [
  {
    path: "/",
    hydrateFallbackElement: loading,
    element: (
      <RouterLinks>
        <Outlet />
      </RouterLinks>
    ),
    children: [
      { index: true, lazy: lazyPage(() => import("./pages/landing-page.js"), (m) => m.RootPage) },
      { path: "sign-in", lazy: lazyPage(() => import("./pages/sign-in-page.js"), (m) => m.SignInPage) },
      { path: "auth/callback", lazy: lazyPage(() => import("./pages/auth-callback-page.js"), (m) => m.AuthCallbackPage) },
      // Central sign-in lands here with a one-time code in the fragment.
      { path: "auth/handoff", lazy: lazyPage(() => import("./pages/handoff-page.js"), (m) => m.HandoffPage) },
      { path: "register", lazy: lazyPage(() => import("./pages/register-page.js"), (m) => m.RegisterPage) },
      { path: "invite", lazy: lazyPage(() => import("./pages/invite-page.js"), (m) => m.InvitePage) },
      { path: "book", lazy: lazyPage(() => import("./pages/public/book-page.js"), (m) => m.BookPage) },
      { path: "shared/:token", lazy: lazyPage(() => import("./pages/public/shared-page.js"), (m) => m.SharedPage) },
      { path: "verify/prescriptions/:token", lazy: lazyPage(() => import("./pages/public/verify-page.js"), (m) => m.VerifyPrescriptionPage) },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ClinicGate />,
            children: [
              { path: "today", lazy: lazyPage(() => import("./pages/today/today-page.js"), (m) => m.TodayPage) },
              { path: "setup", lazy: lazyPage(() => import("./pages/setup/setup-page.js"), (m) => m.SetupPage) },
              { path: "patients", lazy: lazyPage(() => import("./pages/patients/patients-page.js"), (m) => m.PatientsPage) },
              { path: "patients/new", lazy: lazyPage(() => import("./pages/patients/new-patient-page.js"), (m) => m.NewPatientPage) },
              { path: "patients/import", lazy: lazyPage(() => import("./pages/patients/import-page.js"), (m) => m.ImportPage) },
              { path: "patients/incomplete", lazy: lazyPage(() => import("./pages/patients/incomplete-page.js"), (m) => m.IncompletePage) },
              { path: "patients/:id", lazy: lazyPage(() => import("./pages/patients/patient-route.js"), (m) => m.PatientRoute) },
              { path: "patients/:id/edit", lazy: lazyPage(() => import("./pages/patients/edit-patient-page.js"), (m) => m.EditPatientPage) },
              { path: "patients/:id/visits/:visitId", lazy: lazyPage(() => import("./pages/visits/visit-page.js"), (m) => m.VisitPage) },
              { path: "patients/:patientId/prescriptions", element: <PatientRxRedirect /> },
              { path: "calendar", lazy: lazyPage(() => import("./pages/calendar/calendar-page.js"), (m) => m.CalendarPage) },
              { path: "queue", lazy: lazyPage(() => import("./pages/queue/queue-page.js"), (m) => m.QueuePage) },
              { path: "prescriptions", element: <Navigate to="/patients" replace /> },
              { path: "prescriptions/:id", lazy: lazyPage(() => import("./pages/prescriptions/prescription-page.js"), (m) => m.PrescriptionPage) },
              { path: "prescriptions/:id/print", lazy: lazyPage(() => import("./pages/prescriptions/print-page.js"), (m) => m.PrescriptionPrintPage) },
              {
                element: <RequireCan permission="billing.read" what="Billing" />,
                children: [
                  { path: "billing", lazy: lazyPage(() => import("./pages/billing/billing-page.js"), (m) => m.BillingPage) },
                  { path: "billing/invoices/:id", lazy: lazyPage(() => import("./pages/billing/invoice-detail-page.js"), (m) => m.InvoiceDetailPage) },
                  { path: "billing/invoices/:id/print", lazy: lazyPage(() => import("./pages/billing/invoice-print-page.js"), (m) => m.InvoicePrintPage) },
                  { path: "billing/payments/:id/receipt", lazy: lazyPage(() => import("./pages/billing/receipt-print-page.js"), (m) => m.ReceiptPrintPage) },
                ],
              },
              {
                element: <RequireCan permission="finance.view" what="Pending payments" />,
                children: [
                  { path: "billing/pending", lazy: lazyPage(() => import("./pages/billing/pending-page.js"), (m) => m.PendingPaymentsPage) },
                ],
              },
              {
                element: <RequireCan permission="billing.write" what="New bill" />,
                children: [
                  { path: "billing/invoices/new", lazy: lazyPage(() => import("./pages/billing/new-invoice-page.js"), (m) => m.NewInvoicePage) },
                ],
              },
              { path: "stock", lazy: lazyPage(() => import("./pages/stock/stock-page.js"), (m) => m.StockPage) },
              {
                element: <RequireCan permission="analytics.view" what="Analytics" />,
                children: [{ path: "analytics", lazy: lazyPage(() => import("./pages/analytics/analytics-page.js"), (m) => m.AnalyticsPage) }],
              },
              { path: "messages", lazy: lazyPage(() => import("./pages/messages/messages-page.js"), (m) => m.MessagesPage) },
              { path: "staff", element: <Navigate to="/settings?tab=team" replace /> },
              { path: "settings", lazy: lazyPage(() => import("./pages/settings/settings-page.js"), (m) => m.SettingsPage) },
              { path: "*", lazy: lazyPage(() => import("./pages/not-found-page.js"), (m) => m.NotFoundPage) },
            ],
          },
        ],
      },
    ],
  },
];
