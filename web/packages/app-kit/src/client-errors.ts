/**
 * Sends uncaught browser errors to the API (`POST /api/v1/client-errors`), which scrubs them
 * and logs them where Google Cloud Error Reporting groups them with the server's errors.
 *
 * Only an error's name, message and stack are sent, plus the page's path, never its query,
 * fragment, form values or storage. The server scrubs again, but nothing here should need it.
 * At most MAX_REPORTS go out per page load and each distinct error once, so a render loop
 * cannot flood the endpoint. Reporting never throws and never blocks the page.
 */

const MAX_REPORTS = 5;

/** The part of `window` this needs. */
export interface ErrorTarget {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
  location: { pathname: string };
}

export interface ClientErrorReportingOptions {
  /** `portal`, `console` or `website`. */
  app: string;
  /** The build or version, for grouping. */
  release?: string;
  /** Where the API is; defaults to this site's own origin, where the Worker proxies `/api`. */
  apiBase?: string;
  /** For tests. */
  target?: ErrorTarget;
  /** For tests. */
  send?: (url: string, body: string) => void;
}

interface Payload {
  app: string;
  kind: "error" | "unhandledrejection";
  name: string;
  message: string;
  stack?: string | undefined;
  page: string;
  release?: string | undefined;
}

function describe(reason: unknown): { name: string; message: string; stack?: string | undefined } {
  if (reason instanceof Error) {
    return { name: reason.name, message: reason.message, stack: reason.stack };
  }
  // A thrown string or object may hold anything; send its type, not its content.
  return { name: "NonError", message: `thrown ${typeof reason}` };
}

/** Starts reporting. Returns a function that stops it. */
export function installClientErrorReporting(options: ClientErrorReportingOptions): () => void {
  const target = options.target ?? window;
  const url = `${options.apiBase ?? ""}/api/v1/client-errors`;
  const send =
    options.send ??
    ((to: string, body: string) => {
      void fetch(to, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "omit",
      }).catch(() => undefined);
    });
  const seen = new Set<string>();

  function report(kind: Payload["kind"], reason: unknown): void {
    try {
      if (seen.size >= MAX_REPORTS) return;
      const { name, message, stack } = describe(reason);
      const key = `${kind}|${name}|${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      const payload: Payload = {
        app: options.app,
        kind,
        name,
        message: message.slice(0, 500) || name,
        stack: stack?.slice(0, 3000),
        page: target.location.pathname,
        release: options.release,
      };
      send(url, JSON.stringify(payload));
    } catch {
      // Reporting must never break the page.
    }
  }

  const onError = (event: Event): void => {
    const error: unknown = Reflect.get(event, "error");
    report("error", error ?? new Error("error"));
  };
  const onRejection = (event: Event): void => {
    report("unhandledrejection", Reflect.get(event, "reason"));
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
