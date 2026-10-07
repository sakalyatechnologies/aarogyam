import type { ReactNode } from "react";

import { useDocumentTitle } from "@aarogyam/app-kit";

import { useClinic } from "../clinic.js";
import { EmptyState, PageHeader } from "../components/mk/index.js";

export interface ComingSoonPageProps {
  title: string;
  /** What the screen will do, once it has a milestone to build against. */
  description: string;
  icon?: ReactNode;
}

/**
 * A screen the mock-up shows but this milestone doesn't build yet: the nav entry is real, so the
 * design language and permission gating are in place, but the page itself only says what's coming.
 */
export function ComingSoonPage({ title, description, icon }: ComingSoonPageProps) {
  const { session } = useClinic();
  useDocumentTitle(title, session.clinic.name);
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={`${title} is coming soon`} description={description} icon={icon} className="rounded-card border border-border bg-surface" />
    </>
  );
}
