import { useQuery } from "@tanstack/react-query";
import { BookOpen, HeartPulse } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { unwrap } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { EmptyState, ThemeScope } from "@sakalya/ui";

import { useServices } from "../../clinic.js";
import { MOCKUP_BRAND, mockupTheme } from "../../layout/mockup-theme.js";
import { MkCard } from "../../components/mk/index.js";
import { LEARN_TOPICS, findLearnTopic } from "./learn-topics.js";

/**
 * The clinic's public patient-education pages (`/learn` and `/learn/:topic`, on the clinic's host,
 * no sign-in). The welcome message links here. The text is placeholder copy in `learn-topics.ts`.
 * `?clinic=<host>` names the clinic when fake data serves every clinic, as on `/book`.
 */
function LearnFrame({ title, children }: { title: string; children: ReactNode }) {
  const services = useServices();
  const [params] = useSearchParams();
  const host = params.get("clinic") ?? window.location.hostname;
  const options = useQuery({ queryKey: ["book-options", host], queryFn: ({ signal }) => unwrap(services.clinic(host).getBookingOptions({ signal })) });
  const query = params.has("clinic") ? `?clinic=${encodeURIComponent(host)}` : "";
  return (
    <ThemeScope theme={mockupTheme(MOCKUP_BRAND, "light")} className="min-h-full">
      <div className="mk-app min-h-full">
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary">
              <HeartPulse aria-hidden="true" className="size-6" />
            </span>
            <div className="leading-tight">
              <p className="text-xl font-extrabold tracking-tight text-text">{options.data?.clinic_name ?? "Your dental clinic"}</p>
              <p className="text-xs text-muted">{title}</p>
            </div>
          </div>
          {children}
          <p>
            <Link className="font-semibold text-primary underline" to={`/book${query}`}>
              Book a visit
            </Link>
          </p>
        </main>
      </div>
    </ThemeScope>
  );
}

export function LearnIndexPage() {
  useDocumentTitle("Care tips", "Aarogyam");
  const [params] = useSearchParams();
  const query = params.has("clinic") ? `?clinic=${encodeURIComponent(params.get("clinic") ?? "")}` : "";
  return (
    <LearnFrame title="Care tips">
      <h1 className="text-lg font-bold text-text">Care tips</h1>
      <ul className="flex flex-col gap-3">
        {LEARN_TOPICS.map((topic) => (
          <li key={topic.slug}>
            <MkCard>
              <Link className="block font-semibold text-primary underline" to={`/learn/${topic.slug}${query}`}>
                {topic.title}
              </Link>
              <p className="text-sm text-muted">{topic.summary}</p>
            </MkCard>
          </li>
        ))}
      </ul>
    </LearnFrame>
  );
}

export function LearnTopicPage() {
  const { topic: slug } = useParams();
  const topic = findLearnTopic(slug);
  useDocumentTitle(topic?.title ?? "Care tips", "Aarogyam");
  const [params] = useSearchParams();
  const query = params.has("clinic") ? `?clinic=${encodeURIComponent(params.get("clinic") ?? "")}` : "";
  return (
    <LearnFrame title="Care tips">
      {topic === undefined ? (
        <EmptyState
          icon={<BookOpen className="size-7" />}
          title="We couldn't find that page"
          description="Try the list of care tips, or call the clinic."
          action={
            <Link className="font-semibold text-primary underline" to={`/learn${query}`}>
              All care tips
            </Link>
          }
        />
      ) : (
        <MkCard>
          <article className="flex flex-col gap-3">
            <h1 className="text-lg font-bold text-text">{topic.title}</h1>
            <p className="text-sm text-text">{topic.intro}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-text">
              {topic.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
            <Link className="text-sm font-semibold text-primary underline" to={`/learn${query}`}>
              All care tips
            </Link>
          </article>
        </MkCard>
      )}
    </LearnFrame>
  );
}
