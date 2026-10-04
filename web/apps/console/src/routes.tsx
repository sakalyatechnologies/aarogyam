import { Navigate, Outlet, type RouteObject } from "react-router";

import { RouterLinks } from "@aarogyam/app-kit";

import { ConsoleLayout, RequireAuth } from "./layout/console-layout.js";
import { ApplicationsPage } from "./pages/applications/applications-page.js";
import { AuthCallbackPage } from "./pages/auth-callback-page.js";
import { ClinicDetailPage } from "./pages/clinics/clinic-detail-page.js";
import { ClinicsPage } from "./pages/clinics/clinics-page.js";
import { NewClinicPage } from "./pages/clinics/new-clinic-page.js";
import { HealthPage } from "./pages/health/health-page.js";
import { NotFoundPage } from "./pages/not-found-page.js";
import { QualityPage } from "./pages/quality/quality-page.js";
import { SignInPage } from "./pages/sign-in-page.js";

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
      { path: "auth/callback", element: <AuthCallbackPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ConsoleLayout />,
            children: [
              { index: true, element: <Navigate to="/health" replace /> },
              { path: "health", element: <HealthPage /> },
              { path: "quality", element: <QualityPage /> },
              { path: "applications", element: <ApplicationsPage /> },
              { path: "clinics", element: <ClinicsPage /> },
              { path: "clinics/new", element: <NewClinicPage /> },
              { path: "clinics/:id", element: <ClinicDetailPage /> },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
