/**
 * The clinic the user is working in: chosen from their memberships, its session (role,
 * permissions, theme) and a client bound to its host.
 */

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { hasPermission, unwrap, type ApiClient, type ClinicAccess, type Me, type Permission, type Session } from "@aarogyam/api-client";

/** The clinic chosen in this tab, when one page serves every clinic (fake data). */
export const CLINIC_STORAGE_KEY = "aarogyam.portal.clinic";
const STORAGE_KEY = CLINIC_STORAGE_KEY;

export interface Services {
  mode: "fake" | "http";
  neutral: ApiClient;
  clinic: (host: string) => ApiClient;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error("useServices must be used inside a ServicesProvider");
  }
  return services;
}

export function useMe() {
  const { neutral } = useServices();
  return useQuery({ queryKey: ["me"], queryFn: ({ signal }) => unwrap(neutral.getMe({ signal })) });
}

function readStored(): string | null {
  try {
    return globalThis.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Where a clinic's portal lives, on this dev server's port: `http://lotus.localtest.me:5173/`. */
export function clinicUrl(host: string, path = "/"): string {
  const port = window.location.port === "" ? "" : `:${window.location.port}`;
  return `${window.location.protocol}//${host}${port}${path}`;
}

/**
 * The clinic to open. Against the real API it is always this page's host (the API reads the
 * clinic from it), and choosing another clinic goes to that clinic's host. With fake data one
 * page serves every clinic, so the choice is kept for the tab.
 */
export function useClinicChoice(me: Me | undefined) {
  const { mode } = useServices();
  const [chosen, setChosen] = useState<string | null>(readStored);
  const clinics = me?.clinics ?? [];
  const here = clinics.find((c) => c.host === window.location.hostname);
  const current =
    mode === "http" ? here : (here ?? clinics.find((c) => c.slug === chosen) ?? (clinics.length === 1 ? clinics[0] : undefined));
  const choose = (clinic: ClinicAccess) => {
    if (mode === "http") {
      if (clinic.host != null) {
        window.location.assign(clinicUrl(clinic.host));
      }
      return;
    }
    try {
      globalThis.sessionStorage.setItem(STORAGE_KEY, clinic.slug);
    } catch {
      // The choice then lasts for this page only.
    }
    setChosen(clinic.slug);
  };
  return { clinics, current, choose };
}

export interface ClinicContextValue {
  me: Me;
  access: ClinicAccess;
  session: Session;
  api: ApiClient;
  /** Hides what the member can't use. The API still enforces every permission. */
  can: (permission: Permission) => boolean;
  switchClinic: (clinic: ClinicAccess) => void;
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

export function ClinicProvider({ value, children }: { value: ClinicContextValue; children: ReactNode }) {
  return <ClinicContext value={value}>{children}</ClinicContext>;
}

export function useClinic(): ClinicContextValue {
  const clinic = useContext(ClinicContext);
  if (clinic === null) {
    throw new Error("useClinic must be used inside a ClinicProvider");
  }
  return clinic;
}

export function useSession(api: ApiClient | undefined, host: string | undefined) {
  return useQuery({
    queryKey: ["session", host],
    queryFn: ({ signal }) => (api === undefined ? Promise.reject(new Error("no clinic")) : unwrap(api.getSession({ signal }))),
    enabled: api !== undefined,
  });
}

export function useCan(permissions: readonly string[]) {
  return useMemo(() => (permission: Permission) => hasPermission(permissions, permission), [permissions]);
}
