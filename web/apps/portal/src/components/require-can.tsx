import { Outlet } from "react-router";

import type { Permission } from "@aarogyam/api-client";
import { EmptyState } from "@sakalya/ui";

import { useClinic } from "../clinic.js";

/**
 * A layout route that shows its pages only to roles holding `permission`. Everyone else gets a
 * plain notice instead of a request the API would refuse. The API still enforces the rule.
 */
export function RequireCan({ permission, what }: { permission: Permission; what: string }) {
  const { can } = useClinic();
  if (!can(permission)) {
    return <EmptyState title={`${what} isn't available to your role`} description="Ask the clinic owner if you need it." />;
  }
  return <Outlet />;
}
