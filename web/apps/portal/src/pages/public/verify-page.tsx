import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { useParams } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { Card, EmptyState, Skeleton } from "@sakalya/ui";

import { useServices } from "../../clinic.js";

/** The public page a prescription's QR code opens (`/verify/prescriptions/:token`): no sign-in,
 * no patient data beyond the number — just whether it's genuine. */
export function VerifyPrescriptionPage() {
  useDocumentTitle("Verify a prescription", "Aarogyam");
  const params = useParams();
  const token = params.token ?? "";
  const services = useServices();
  const verification = useQuery({
    queryKey: ["verify-prescription", token],
    queryFn: () => services.neutral.verifyPrescription(token),
  });

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">
        {verification.isPending ? (
          <Skeleton shape="block" />
        ) : !verification.data?.ok ? (
          <EmptyState icon={<ShieldAlert className="size-7" />} title="Not found" description="This QR code doesn't match a known prescription." />
        ) : verification.data.value.status === "valid" ? (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-soft text-success-text">
              <BadgeCheck aria-hidden="true" className="size-7" />
            </span>
            <h1 className="mt-3 text-xl font-extrabold tracking-tight text-text">Genuine prescription</h1>
            <p className="mt-1 text-sm text-muted">
              {verification.data.value.number == null ? "" : `${verification.data.value.number} · `}
              {verification.data.value.clinic_name}
            </p>
            {verification.data.value.issued_on == null ? null : (
              <p className="text-xs text-muted">Issued {verification.data.value.issued_on}</p>
            )}
          </>
        ) : (
          <EmptyState
            icon={<ShieldAlert className="size-7" />}
            title="This prescription was cancelled"
            description={`${verification.data.value.number ?? ""} from ${verification.data.value.clinic_name} is no longer valid.`}
          />
        )}
      </Card>
    </main>
  );
}
