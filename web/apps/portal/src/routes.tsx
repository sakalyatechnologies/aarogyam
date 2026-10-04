import { Outlet, type RouteObject } from "react-router";

import { RouterLinks } from "@aarogyam/app-kit";

import { ClinicGate, RequireAuth } from "./layout/portal-layout.js";
import { AuthCallbackPage } from "./pages/auth-callback-page.js";
import { BillingPage } from "./pages/billing/billing-page.js";
import { InvoiceDetailPage } from "./pages/billing/invoice-detail-page.js";
import { InvoicePrintPage } from "./pages/billing/invoice-print-page.js";
import { NewInvoicePage } from "./pages/billing/new-invoice-page.js";
import { PendingPaymentsPage } from "./pages/billing/pending-page.js";
import { ReceiptPrintPage } from "./pages/billing/receipt-print-page.js";
import { CalendarPage } from "./pages/calendar/calendar-page.js";
import { ComingSoonPage } from "./pages/coming-soon-page.js";
import { InvitePage } from "./pages/invite-page.js";
import { RootPage } from "./pages/landing-page.js";
import { MessagesPage } from "./pages/messages/messages-page.js";
import { NotFoundPage } from "./pages/not-found-page.js";
import { EditPatientPage } from "./pages/patients/edit-patient-page.js";
import { ImportPage } from "./pages/patients/import-page.js";
import { NewPatientPage } from "./pages/patients/new-patient-page.js";
import { PatientPage } from "./pages/patients/patient-page.js";
import { PatientsPage } from "./pages/patients/patients-page.js";
import { PatientPrescriptionsPage } from "./pages/prescriptions/patient-prescriptions-page.js";
import { PrescriptionPage } from "./pages/prescriptions/prescription-page.js";
import { PrescriptionsPage } from "./pages/prescriptions/prescriptions-page.js";
import { PrescriptionPrintPage } from "./pages/prescriptions/print-page.js";
import { SharedPage } from "./pages/public/shared-page.js";
import { VerifyPrescriptionPage } from "./pages/public/verify-page.js";
import { QueuePage } from "./pages/queue/queue-page.js";
import { RegisterPage } from "./pages/register-page.js";
import { SettingsPage } from "./pages/settings/settings-page.js";
import { VisitPage } from "./pages/visits/visit-page.js";
import { SignInPage } from "./pages/sign-in-page.js";
import { TodayPage } from "./pages/today/today-page.js";

/** Paths carry IDs only: never names, phones or search terms. The invite token rides in the fragment. */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: (
      <RouterLinks>
        <Outlet />
      </RouterLinks>
    ),
    children: [
      { index: true, element: <RootPage /> },
      { path: "sign-in", element: <SignInPage /> },
      { path: "auth/callback", element: <AuthCallbackPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "invite", element: <InvitePage /> },
      { path: "shared/:token", element: <SharedPage /> },
      { path: "verify/prescriptions/:token", element: <VerifyPrescriptionPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ClinicGate />,
            children: [
              { path: "today", element: <TodayPage /> },
              { path: "patients", element: <PatientsPage /> },
              { path: "patients/new", element: <NewPatientPage /> },
              { path: "patients/import", element: <ImportPage /> },
              { path: "patients/:id", element: <PatientPage /> },
              { path: "patients/:id/edit", element: <EditPatientPage /> },
              { path: "patients/:id/visits/:visitId", element: <VisitPage /> },
              { path: "patients/:patientId/prescriptions", element: <PatientPrescriptionsPage /> },
              { path: "calendar", element: <CalendarPage /> },
              { path: "queue", element: <QueuePage /> },
              { path: "prescriptions", element: <PrescriptionsPage /> },
              { path: "prescriptions/:id", element: <PrescriptionPage /> },
              { path: "prescriptions/:id/print", element: <PrescriptionPrintPage /> },
              { path: "billing", element: <BillingPage /> },
              { path: "billing/pending", element: <PendingPaymentsPage /> },
              { path: "billing/invoices/new", element: <NewInvoicePage /> },
              { path: "billing/invoices/:id", element: <InvoiceDetailPage /> },
              { path: "billing/invoices/:id/print", element: <InvoicePrintPage /> },
              { path: "billing/payments/:id/receipt", element: <ReceiptPrintPage /> },
              {
                path: "stock",
                element: <ComingSoonPage title="Stock" description="Material and medicine stock levels. Not yet scheduled." />,
              },
              { path: "messages", element: <MessagesPage /> },
              { path: "settings", element: <SettingsPage /> },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
