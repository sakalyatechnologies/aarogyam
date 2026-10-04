import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createQueryClient } from "@aarogyam/app-kit";
import { AuthProvider } from "@aarogyam/auth";
import { createTheme, preset } from "@sakalya/tokens";
import { ThemeScope, ToastProvider } from "@sakalya/ui";

import { ServicesProvider } from "./clinic.js";
import { routes } from "./routes.js";
import type { PortalServices } from "./services.js";

const MINT = preset("mint");
/** Aarogyam's own look, until a clinic's theme takes over after sign-in. */
const DEFAULT_THEME = createTheme({ brand: MINT.brand, mode: "light", radius: MINT.radius, surface: MINT.surface });

export function Providers({ services, queryClient, children }: { services: PortalServices; queryClient: QueryClient; children: ReactNode }) {
  return (
    <AuthProvider client={services.auth}>
      <ServicesProvider services={services}>
        <QueryClientProvider client={queryClient}>
          <ThemeScope theme={DEFAULT_THEME} className="min-h-full">
            <ToastProvider appearance="pill">{children}</ToastProvider>
          </ThemeScope>
        </QueryClientProvider>
      </ServicesProvider>
    </AuthProvider>
  );
}

export function App({ services }: { services: PortalServices }) {
  const [queryClient] = useState(() =>
    createQueryClient({
      onUnauthenticated: () => {
        void services.auth.signOut();
      },
    }),
  );
  const [router] = useState(() => createBrowserRouter(routes));
  // Patient data fetched for one person never survives their sign-out on a shared PC.
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
