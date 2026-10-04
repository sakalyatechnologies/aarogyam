import { Navigate, Outlet, type RouteObject } from "react-router";

import { RouterLinks } from "@aarogyam/app-kit";

import { ClinicGate, RequireAuth } from "./layout/portal-layout.js";
import { ComingSoonPage } from "./pages/coming-soon-page.js";
import { InvitePage } from "./pages/invite-page.js";
import { NotFoundPage } from "./pages/not-found-page.js";
import { NewPatientPage } from "./pages/patients/new-patient-page.js";
import { PatientPage } from "./pages/patients/patient-page.js";
import { PatientsPage } from "./pages/patients/patients-page.js";
import { SettingsPage } from "./pages/settings/settings-page.js";
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
      { path: "sign-in", element: <SignInPage /> },
      { path: "invite", element: <InvitePage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ClinicGate />,
            children: [
              { index: true, element: <Navigate to="/today" replace /> },
              { path: "today", element: <TodayPage /> },
              { path: "patients", element: <PatientsPage /> },
              { path: "patients/new", element: <NewPatientPage /> },
              { path: "patients/:id", element: <PatientPage /> },
              {
                path: "calendar",
                element: <ComingSoonPage title="Calendar" description="Book and see the week at a glance, once appointment booking lands in M3." />,
              },
              {
                path: "billing",
                element: <ComingSoonPage title="Billing" description="Collections, invoices and payments, once billing lands in M5." />,
              },
              {
                path: "stock",
                element: <ComingSoonPage title="Stock" description="Material and medicine stock levels. Not yet scheduled." />,
              },
              {
                path: "messages",
                element: <ComingSoonPage title="Messages" description="Reminders, recalls and campaigns. Not yet scheduled." />,
              },
              { path: "settings", element: <SettingsPage /> },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
