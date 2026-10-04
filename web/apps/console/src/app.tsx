import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createQueryClient } from "@aarogyam/app-kit";
import { AuthProvider } from "@aarogyam/auth";
import { createTheme, preset } from "@sakalya/tokens";
import { ThemeScope } from "@sakalya/ui";

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
            {children}
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
        void services.auth.signOut();
      },
    }),
  );
  const [router] = useState(() => createBrowserRouter(routes));
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
