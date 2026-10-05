import { Printer } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useParams } from "react-router";

import { prescriptionId as prescriptionIdSchema } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Skeleton } from "@sakalya/ui";

import { QrCode } from "../../components/qr-code.js";
import { usePrescription } from "./queries.js";

/** `print.letterhead`/`print.doctor` arrive as untyped JSON; reads a field without a cast. */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

const TIMING_LABEL: Readonly<Record<string, string>> = {
  before_food: "Before food",
  after_food: "After food",
  empty_stomach: "Empty stomach",
  bedtime: "Bedtime",
  sos: "As needed",
  as_directed: "As directed",
};

/** The printed prescription: letterhead, doctor, items, footer and a QR code that verifies it. */
export function PrescriptionPrintPage() {
  const params = useParams();
  const location = useLocation();
  // The PIN exists only at issue time, so the issuing screen hands it over for the paper copy.
  const statePin: unknown = isRecord(location.state) ? location.state.pin : undefined;
  const pin = typeof statePin === "string" && statePin !== "" ? statePin : undefined;
  const parsed = prescriptionIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const rx = usePrescription(id);
  useDocumentTitle(rx.data?.number ?? "Prescription", "Print");

  useEffect(() => {
    if (rx.data?.print !== undefined && rx.data.print !== null) {
      const timer = setTimeout(() => {
        window.print();
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [rx.data]);

  if (id === undefined) {
    return <ApiErrorNotice title="That prescription address isn't valid" error={{ status: 404, code: "not_found", message: "No such prescription." }} />;
  }
  if (rx.isPending) {
    return <Skeleton shape="block" />;
  }
  if (rx.isError) {
    return <ApiErrorNotice title="Couldn't load this prescription" error={rx.error} onRetry={() => void rx.refetch()} />;
  }
  const prescription = rx.data;
  const print = prescription.print;
  if (print === null || print === undefined) {
    return <ApiErrorNotice title="Not issued yet" error={{ status: 409, code: "conflict", message: "Only an issued prescription can be printed." }} />;
  }

  const letterheadName = stringField(print.letterhead, "legal_name") ?? stringField(print.letterhead, "name");
  const letterheadPhone = stringField(print.letterhead, "phone");
  const addressRecord = recordField(print.letterhead, "address");
  const address =
    addressRecord === undefined
      ? ""
      : (["line1", "line2", "city", "state", "pincode"] as const)
          .map((key) => stringField(addressRecord, key))
          .filter((part): part is string => part != null && part !== "")
          .join(", ");
  const doctorName = stringField(print.doctor, "display_name");
  const doctorRegistration = stringField(print.doctor, "registration_number");
  const verifyUrl = `${window.location.origin}${print.verify_path}`;

  return (
    <div className="print-area mx-auto max-w-2xl bg-surface p-6 text-text">
      <div className="mb-4 flex justify-end print:hidden">
        <Button
          icon={<Printer aria-hidden="true" className="size-4" />}
          onClick={() => {
            window.print();
          }}
        >
          Print
        </Button>
      </div>
      <header className="border-b border-border pb-4">
        <p className="text-xl font-extrabold tracking-tight">{letterheadName ?? ""}</p>
        {address === "" ? null : <p className="text-sm text-muted">{address}</p>}
        {letterheadPhone == null ? null : <p className="text-sm text-muted">{letterheadPhone}</p>}
        <p className="mt-2 text-sm font-semibold">
          {doctorName ?? "Doctor"}
          {doctorRegistration == null ? "" : ` · Reg. no. ${doctorRegistration}`}
        </p>
      </header>

      <div className="mt-4 flex items-center justify-between text-sm">
        <div>
          <p className="font-semibold">{prescription.patient.name}</p>
          <p className="text-muted">{prescription.patient.number}</p>
        </div>
        <div className="text-right text-muted">
          <p className="font-mono font-semibold text-text">{prescription.number}</p>
          {prescription.issued_at == null ? null : <p>{new Date(prescription.issued_at).toLocaleDateString("en-IN")}</p>}
        </div>
      </div>

      {prescription.diagnosis_text == null ? null : <p className="mt-4 text-sm">Diagnosis: {prescription.diagnosis_text}</p>}

      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted uppercase">
            <th className="py-2">#</th>
            <th className="py-2">Medicine</th>
            <th className="py-2">Dose &amp; frequency</th>
            <th className="py-2">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {prescription.items.map((item, index) => (
            <tr key={index}>
              <td className="py-2 align-top">{index + 1}</td>
              <td className="py-2 align-top">
                <p className="font-semibold">
                  {item.drug_name} {item.strength}
                </p>
                {item.instructions == null || item.instructions === "" ? null : <p className="text-xs text-muted">{item.instructions}</p>}
              </td>
              <td className="py-2 align-top">
                {item.dose} · {item.frequency}
                {item.timing == null ? "" : ` · ${TIMING_LABEL[item.timing] ?? item.timing}`}
              </td>
              <td className="py-2 align-top">{item.duration_days == null ? "—" : `${String(item.duration_days)} days`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {prescription.advice == null ? null : <p className="mt-4 text-sm">Advice: {prescription.advice}</p>}
      {prescription.follow_up_on == null ? null : (
        <p className="mt-1 text-sm">Follow up: {new Date(prescription.follow_up_on).toLocaleDateString("en-IN")}</p>
      )}

      <footer className="mt-8 flex items-end justify-between border-t border-border pt-4">
        <div>
          {print.footer == null ? null : <p className="max-w-sm text-xs text-muted">{print.footer}</p>}
          <p className="mt-1 text-xs text-muted">{print.brand_line}</p>
          {pin === undefined ? null : <p className="mt-2 text-sm">PIN to open your copy online: <span className="font-mono tracking-widest">{pin}</span></p>}
        </div>
        <div className="flex flex-col items-center gap-1">
          <QrCode value={verifyUrl} size={88} label="Scan to verify this prescription" />
          <p className="text-[10px] text-muted">Scan to verify</p>
        </div>
      </footer>
    </div>
  );
}
