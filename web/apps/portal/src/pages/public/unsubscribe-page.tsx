import { useMutation } from "@tanstack/react-query";
import { MailX, MailCheck, ShieldAlert } from "lucide-react";
import { useLocation } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, EmptyState } from "@sakalya/ui";

import { useServices } from "../../clinic.js";

/** The page a reminder or offer email's "Unsubscribe" link opens (`/unsubscribe#<token>`): no
 * sign-in. It asks first, so a mail scanner opening the link unsubscribes nobody. The token rides
 * in the fragment, which browsers never send to a server, and the page shows nothing about the
 * patient. */
export function UnsubscribePage() {
  useDocumentTitle("Unsubscribe", "Aarogyam");
  const { hash } = useLocation();
  const token = hash.startsWith("#") ? hash.slice(1) : "";
  const { neutral } = useServices();
  const stop = useMutation({
    // `false` for a link the server doesn't know; other failures are errors, worth a retry.
    mutationFn: async () => {
      const result = await neutral.unsubscribe(token);
      if (result.ok || result.error.status === 404) {
        return result.ok;
      }
      throw new Error(result.error.message);
    },
  });

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">
        {token === "" || stop.data === false ? (
          <EmptyState icon={<ShieldAlert className="size-7" />} title="This link isn't valid" description="It may be cut short or from an old email. You can also ask the clinic to stop these emails." />
        ) : stop.data === true ? (
          <EmptyState
            icon={<MailCheck className="size-7" />}
            title="You're unsubscribed"
            description="You won't get emails like this one from the clinic again. Receipts and messages about your care still arrive. To start them again, ask the clinic."
          />
        ) : (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-text">
              <MailX aria-hidden="true" className="size-7" />
            </span>
            <h1 className="mt-3 text-xl font-extrabold tracking-tight text-text">Stop these emails?</h1>
            <p className="mt-1 text-sm text-muted">You'll stop getting emails like the one you opened from this clinic. Receipts and messages about your care still arrive.</p>
            {stop.isError ? <p className="mt-3 text-sm text-danger-text">Couldn't unsubscribe just now. Please try again.</p> : null}
            <div className="mt-5 flex justify-center">
              <Button disabled={stop.isPending} onClick={() => {
                  stop.mutate();
                }}>
                {stop.isPending ? "Unsubscribing…" : "Unsubscribe"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
