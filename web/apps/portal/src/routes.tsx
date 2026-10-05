import { Outlet, type RouteObject } from "react-router";

import { lazyPage, RouterLinks } from "@aarogyam/app-kit";

import { ClinicGate, RequireAuth } from "./layout/portal-layout.js";

/** Shown while the first page's code loads. */
const loading = <div className="p-6" role="status" aria-label="Loading" />;

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
              { path: "patients", lazy: lazyPage(() => import("./pages/patients/patients-page.js"), (m) => m.PatientsPage) },
              { path: "patients/new", lazy: lazyPage(() => import("./pages/patients/new-patient-page.js"), (m) => m.NewPatientPage) },
              { path: "patients/import", lazy: lazyPage(() => import("./pages/patients/import-page.js"), (m) => m.ImportPage) },
              { path: "patients/:id", lazy: lazyPage(() => import("./pages/patients/patient-page.js"), (m) => m.PatientPage) },
              { path: "patients/:id/edit", lazy: lazyPage(() => import("./pages/patients/edit-patient-page.js"), (m) => m.EditPatientPage) },
              { path: "patients/:id/visits/:visitId", lazy: lazyPage(() => import("./pages/visits/visit-page.js"), (m) => m.VisitPage) },
              { path: "patients/:patientId/prescriptions", lazy: lazyPage(() => import("./pages/prescriptions/patient-prescriptions-page.js"), (m) => m.PatientPrescriptionsPage) },
              { path: "calendar", lazy: lazyPage(() => import("./pages/calendar/calendar-page.js"), (m) => m.CalendarPage) },
              { path: "queue", lazy: lazyPage(() => import("./pages/queue/queue-page.js"), (m) => m.QueuePage) },
              { path: "prescriptions", lazy: lazyPage(() => import("./pages/prescriptions/prescriptions-page.js"), (m) => m.PrescriptionsPage) },
              { path: "prescriptions/:id", lazy: lazyPage(() => import("./pages/prescriptions/prescription-page.js"), (m) => m.PrescriptionPage) },
              { path: "prescriptions/:id/print", lazy: lazyPage(() => import("./pages/prescriptions/print-page.js"), (m) => m.PrescriptionPrintPage) },
              { path: "billing", lazy: lazyPage(() => import("./pages/billing/billing-page.js"), (m) => m.BillingPage) },
              { path: "billing/pending", lazy: lazyPage(() => import("./pages/billing/pending-page.js"), (m) => m.PendingPaymentsPage) },
              { path: "billing/invoices/new", lazy: lazyPage(() => import("./pages/billing/new-invoice-page.js"), (m) => m.NewInvoicePage) },
              { path: "billing/invoices/:id", lazy: lazyPage(() => import("./pages/billing/invoice-detail-page.js"), (m) => m.InvoiceDetailPage) },
              { path: "billing/invoices/:id/print", lazy: lazyPage(() => import("./pages/billing/invoice-print-page.js"), (m) => m.InvoicePrintPage) },
              { path: "billing/payments/:id/receipt", lazy: lazyPage(() => import("./pages/billing/receipt-print-page.js"), (m) => m.ReceiptPrintPage) },
              { path: "stock", lazy: lazyPage(() => import("./pages/stock/stock-page.js"), (m) => m.StockPage) },
              { path: "messages", lazy: lazyPage(() => import("./pages/messages/messages-page.js"), (m) => m.MessagesPage) },
              { path: "settings", lazy: lazyPage(() => import("./pages/settings/settings-page.js"), (m) => m.SettingsPage) },
              { path: "*", lazy: lazyPage(() => import("./pages/not-found-page.js"), (m) => m.NotFoundPage) },
            ],
          },
        ],
      },
    ],
  },
];
