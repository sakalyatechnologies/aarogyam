import { useDocumentTitle } from "@aarogyam/app-kit";
import { CardLink, EmptyState } from "@sakalya/ui";

export function NotFoundPage({ title = "There's nothing here" }: { title?: string }) {
  useDocumentTitle("Not found", "Aarogyam");
  return <EmptyState title={title} description="Check the address, or go back to today's work." action={<CardLink href="/">Today</CardLink>} />;
}
