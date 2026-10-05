import { Check, Copy } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { apiErrorOf, type SiteDomain } from "@aarogyam/api-client";
import { Button, Field, Pill, RadioGroup, TextInput, useToast } from "@sakalya/ui";

/** Registrars the guide has steps for. Menu names differ a little between accounts, so the steps say what to look for. */
const REGISTRARS = [
  {
    name: "GoDaddy",
    steps: [
      "Sign in and open My Products, then next to your domain choose DNS.",
      "Choose Add New Record. Pick the type, paste the Name and the Value from the table, and keep the TTL at the default.",
      "Save each record. Leave every other record as it is.",
    ],
  },
  {
    name: "Hostinger",
    steps: [
      "Open Domains, choose your domain, then DNS / Nameservers, then DNS records.",
      "Under Add record, pick the type, fill Name and the Points to / Content value, and leave the TTL at the default.",
      "Choose Add record for each one. If a record with the same name and type already exists, edit it instead.",
    ],
  },
  {
    name: "BigRock",
    steps: [
      "Open Manage next to your domain, then DNS Management (or Manage DNS Records).",
      "Choose Add a record, pick the type and fill Host Name and the Value from the table.",
      "Save. BigRock can take a few hours to show new records.",
    ],
  },
  {
    name: "Namecheap",
    steps: [
      "Open Domain List, choose Manage, then the Advanced DNS tab.",
      "Choose Add New Record. Pick the type, put the Host from the table (for example www) and paste the Value. Leave the TTL on Automatic.",
      "Save with the tick. Your domain must use Namecheap BasicDNS or PremiumDNS for these records to count.",
    ],
  },
] as const;

const STATUS: Record<SiteDomain["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  none: { label: "No domain", tone: "neutral" },
  pending: { label: "Waiting for your records", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  failed: { label: "Records not found yet", tone: "danger" },
};

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="wb-copy">
      <code>{value}</code>
      <button
        type="button"
        className="wb-copy-btn"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => {
                setCopied(false);
              }, 1600);
            })
            .catch(() => {
              // Copying needs a secure page; the value stays selectable.
            });
        }}
      >
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </span>
  );
}

/** The part of a domain the records hang from: `www.clinic.in` and `clinic.in` both give `clinic.in`. */
export function rootOf(domain: string): string {
  return domain.replace(/^www\./, "");
}

export interface DomainTabProps {
  domain: SiteDomain;
  saving: boolean;
  onSave: (domain: string) => Promise<unknown>;
}

/** The custom domain step: no hosting yet, so this shows the records to add and keeps the owner's choice. */
export function DomainTab({ domain, saving, onSave }: DomainTabProps) {
  const toast = useToast();
  const [has, setHas] = useState<"yes" | "no">(domain.custom_domain != null ? "yes" : "no");
  const [text, setText] = useState(domain.custom_domain ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const save = (value: string) =>
    onSave(value).catch((thrown: unknown) => {
      const message = apiErrorOf(thrown)?.message ?? "Couldn't save the domain. Please try again.";
      setError(message);
      toast.show({ title: message, tone: "danger" });
    });
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    void save(text);
  };
  const root = domain.custom_domain == null ? "" : rootOf(domain.custom_domain);
  const status = STATUS[domain.status];
  return (
    <div className="wb-stack">
      <RadioGroup
        label="Do you have a domain?"
        hint="A domain is an address you own, like yourclinic.in."
        orientation="horizontal"
        value={has}
        onValueChange={setHas}
        options={[
          { value: "yes", label: "Yes, I have one" },
          { value: "no", label: "No, use a free address" },
        ]}
      />

      {has === "no" ? (
        <div className="wb-note">
          <h3>Your free address</h3>
          <p>
            Your website will open at <CopyValue value={domain.default_address} label="website address" />
          </p>
          <p className="wb-muted">You can add your own domain at any time. Nothing else is needed.</p>
          {domain.custom_domain != null && (
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                void save("");
              }}
            >
              Remove {domain.custom_domain}
            </Button>
          )}
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="wb-domain-form">
            <Field label="Your domain" hint="Without https://, for example yourclinic.in" error={error}>
              <TextInput
                value={text}
                inputMode="url"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="yourclinic.in"
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            </Field>
            <Button type="submit" disabled={saving || text.trim() === "" || text.trim() === domain.custom_domain}>
              {domain.custom_domain == null ? "Show me the records" : "Change domain"}
            </Button>
          </form>

          {domain.custom_domain != null && (
            <>
              <div className="wb-status">
                <Pill tone={status.tone}>{status.label}</Pill>
                <span>
                  <b>{domain.custom_domain}</b>
                </span>
              </div>
              <p>Add these two records where you manage your domain (your registrar). They connect your website and prove the domain is yours.</p>
              <div className="wb-tablewrap">
                <table className="wb-records">
                  <caption className="mk-sr">DNS records to add for {domain.custom_domain}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Name / Host</th>
                      <th scope="col">Value / Points to</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>CNAME</td>
                      <td>
                        <CopyValue value="www" label="CNAME name" />
                      </td>
                      <td>
                        <CopyValue value={domain.sites_target} label="CNAME value" />
                      </td>
                    </tr>
                    <tr>
                      <td>TXT</td>
                      <td>
                        <CopyValue value="_aarogyam-verify" label="TXT name" />
                      </td>
                      <td>
                        <CopyValue value={domain.verification_token ?? ""} label="TXT value" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="wb-muted">
                Your site will open at <b>www.{root}</b>. For <b>{root}</b> without www, use your registrar&apos;s domain forwarding to send it to www.{root}.
              </p>
              <div className="wb-warning" role="note">
                <b>Do not change your MX records.</b> MX records deliver your email. Leave them exactly as they are, or email sent to you@{root} can stop working. You only add the two records above.
              </div>

              <h3 className="wb-h3">How to add them</h3>
              <div className="wb-guides">
                {REGISTRARS.map((registrar) => (
                  <details key={registrar.name}>
                    <summary>{registrar.name}</summary>
                    <ol>
                      {registrar.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
              <p className="wb-muted">Records can take from a few minutes to a day to spread. We check them once hosting is connected, so there is nothing more to do now.</p>
              <div>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setText("");
                    void save("");
                  }}
                >
                  Remove this domain
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
