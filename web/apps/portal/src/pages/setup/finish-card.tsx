import { X } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router";

import { useToast } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { wantsLater } from "./later.js";
import { useMySetup, useUpdateMySetup } from "./queries.js";
import "./setup.css";

/**
 * An invited doctor's one-screen profile: the first time they open Today with nothing answered it
 * opens the setup once, and after that a dismissible card remains. Owners never see it.
 */
export function FinishSetupCard() {
  const { can } = useClinic();
  if (can("settings.manage")) {
    // Owners finish setup before they ever see Today (see SetupGate), so there is nothing to nag about.
    return null;
  }
  if (can("prescriptions.issue")) {
    return <MemberCard />;
  }
  return null;
}

function MemberCard() {
  const setup = useMySetup();
  const update = useUpdateMySetup();
  return <Card standing={setup.data?.standing} steps={setup.data?.steps} dismiss={() => update.mutateAsync({ dismissed: true })} busy={update.isPending} />;
}

function Card({
  standing,
  steps,
  dismiss,
  busy,
}: {
  standing: "new" | "in_progress" | "complete" | "dismissed" | undefined;
  steps: readonly { key: string; status: "todo" | "done" | "skipped" }[] | undefined;
  dismiss: () => Promise<unknown>;
  busy: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const first = standing === "new" && !wantsLater();
  useEffect(() => {
    if (first) {
      void navigate("/setup", { replace: true });
    }
  }, [first, navigate]);
  if (steps === undefined || (standing !== "new" && standing !== "in_progress")) {
    return null;
  }
  const answered = steps.filter((step) => step.status !== "todo").length;
  return (
    <MkCard className="sw-card-wrap">
      <div className="sw-card" role="region" aria-label="Finish setting up">
        <div>
          <h2>Finish setting up</h2>
          <p>
            {answered} of {steps.length} steps answered. The rest takes a few minutes.
          </p>
          <div className="sw-meter" aria-hidden="true">
            {steps.map((step) => (
              <i key={step.key} data-on={step.status !== "todo"} />
            ))}
          </div>
        </div>
        <div className="sw-card-actions">
          <Link to="/setup" className="mk-btn mk-btn-primary">
            Continue setup
          </Link>
          <button
            type="button"
            className="sw-icon"
            aria-label="Dismiss setup guide"
            disabled={busy}
            onClick={() => {
              dismiss().then(
                () => {
                  toast.show({
                    title: "Setup guide hidden. Everything is still in Settings.",
                    tone: "success",
                  });
                },
                () => {
                  toast.show({
                    title: "Couldn't hide that. Please try again.",
                    tone: "danger",
                  });
                },
              );
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    </MkCard>
  );
}
