import { useDocumentTitle } from "@aarogyam/app-kit";
import { CardLink, EmptyState } from "@sakalya/ui";

export function NotFoundPage() {
  useDocumentTitle("Not found", "Sakalya Console");
  return <EmptyState title="There's nothing here" description="This page doesn't exist yet." action={<CardLink href="/health">Service health</CardLink>} />;
}
