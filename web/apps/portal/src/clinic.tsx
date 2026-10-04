/**
 * The clinic the user is working in: chosen from their memberships, its session (role,
 * permissions, theme) and a client bound to its host.
 */

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { hasPermission, unwrap, type ApiClient, type ClinicAccess, type Me, type Permission, type Session } from "@aarogyam/api-client";

const STORAGE_KEY = "aarogyam.portal.clinic";

export interface Services {
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

/** The clinic to open: this page's own host (production), the tab's last choice, or the only one. */
export function useClinicChoice(me: Me | undefined) {
  const [chosen, setChosen] = useState<string | null>(readStored);
  const clinics = me?.clinics ?? [];
  const current =
    clinics.find((c) => c.host === window.location.host) ??
    clinics.find((c) => c.slug === chosen) ??
    (clinics.length === 1 ? clinics[0] : undefined);
  const choose = (slug: string) => {
    try {
      globalThis.sessionStorage.setItem(STORAGE_KEY, slug);
    } catch {
      // The choice then lasts for this page only.
    }
    setChosen(slug);
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
  switchClinic: (slug: string) => void;
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
