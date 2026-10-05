import { Navigate, Outlet, type RouteObject } from "react-router";

import { lazyPage, RouterLinks } from "@aarogyam/app-kit";

import { ConsoleLayout, RequireAuth } from "./layout/console-layout.js";

/** Shown while the first page's code loads. */
const loading = <div className="p-6" role="status" aria-label="Loading" />;

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
      { path: "sign-in", lazy: lazyPage(() => import("./pages/sign-in-page.js"), (m) => m.SignInPage) },
      { path: "auth/callback", lazy: lazyPage(() => import("./pages/auth-callback-page.js"), (m) => m.AuthCallbackPage) },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ConsoleLayout />,
            children: [
              { index: true, element: <Navigate to="/health" replace /> },
              { path: "health", lazy: lazyPage(() => import("./pages/health/health-page.js"), (m) => m.HealthPage) },
              { path: "quality", lazy: lazyPage(() => import("./pages/quality/quality-page.js"), (m) => m.QualityPage) },
              { path: "applications", lazy: lazyPage(() => import("./pages/applications/applications-page.js"), (m) => m.ApplicationsPage) },
              { path: "clinics", lazy: lazyPage(() => import("./pages/clinics/clinics-page.js"), (m) => m.ClinicsPage) },
              { path: "clinics/new", lazy: lazyPage(() => import("./pages/clinics/new-clinic-page.js"), (m) => m.NewClinicPage) },
              { path: "clinics/:id", lazy: lazyPage(() => import("./pages/clinics/clinic-detail-page.js"), (m) => m.ClinicDetailPage) },
              { path: "*", lazy: lazyPage(() => import("./pages/not-found-page.js"), (m) => m.NotFoundPage) },
            ],
          },
        ],
      },
    ],
  },
];
