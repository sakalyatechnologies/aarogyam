import { Navigate, Outlet, type RouteObject } from "react-router";

import { RouterLinks } from "@aarogyam/app-kit";

import { ClinicGate, RequireAuth } from "./layout/portal-layout.js";
import { InvitePage } from "./pages/invite-page.js";
import { NotFoundPage } from "./pages/not-found-page.js";
import { NewPatientPage } from "./pages/patients/new-patient-page.js";
import { PatientPage } from "./pages/patients/patient-page.js";
import { PatientsPage } from "./pages/patients/patients-page.js";
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
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
