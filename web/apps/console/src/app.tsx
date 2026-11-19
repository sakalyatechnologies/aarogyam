import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createQueryClient, installPageTelemetry, watchRouteTemplate } from "@aarogyam/app-kit";
import { AuthProvider } from "@aarogyam/auth";
import { createTheme, preset } from "@sakalya/tokens";
import { ThemeScope, ToastProvider } from "@sakalya/ui";

import { ApiProvider } from "./api.js";
import { routes } from "./routes.js";
import type { ConsoleServices } from "./services.js";

const INDIGO = preset("indigo");
const CONSOLE_THEME = createTheme({ brand: INDIGO.brand, mode: "light", radius: INDIGO.radius, surface: INDIGO.surface });

export function Providers({ services, queryClient, children }: { services: ConsoleServices; queryClient: QueryClient; children: ReactNode }) {
  return (
    <AuthProvider client={services.auth}>
      <ApiProvider client={services.api}>
        <QueryClientProvider client={queryClient}>
          <ThemeScope theme={CONSOLE_THEME} className="min-h-full">
            <ToastProvider>{children}</ToastProvider>
          </ThemeScope>
        </QueryClientProvider>
      </ApiProvider>
    </AuthProvider>
  );
}

export function App({ services }: { services: ConsoleServices }) {
  const [queryClient] = useState(() =>
    createQueryClient({
      onUnauthenticated: () => {
        // The API refused this session; other devices stay signed in.
        void services.auth.forget();
      },
    }),
  );
  const [router] = useState(() => createBrowserRouter(routes));
  // Error reports and page counters name the route template, never the address.
  useEffect(() => watchRouteTemplate(router), [router]);
  // The console's own pages count too (no clinic), against the real API only.
  useEffect(
    () => (services.telemetry === true ? installPageTelemetry({ router, getToken: services.auth.getAccessToken }) : undefined),
    [router, services],
  );
  // Nothing fetched for one person survives their sign-out.
  useEffect(
    () =>
      services.auth.subscribe(() => {
        if (services.auth.getState().status === "signed_out") {
          queryClient.clear();
        }
      }),
    [services.auth, queryClient],
  );
  return (
    <Providers services={services} queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  );
}
