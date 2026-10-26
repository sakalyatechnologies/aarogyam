/** Server-sent events over `fetch`: the browser's `EventSource` cannot send the Bearer token. */

export interface LiveEvent {
  /** `ready`, `queue.changed`, `visit.changed`, `appointment.changed`, `notification.created` or `resync`. */
  type: string;
  /** The `id:` of the event, to send back as `Last-Event-ID` when reconnecting. */
  id?: string | undefined;
  /** The parsed `data:` JSON; the raw text when it is not JSON, `null` when empty. */
  data: unknown;
}

export interface SubscribeEventsOptions {
  branchId?: string | undefined;
  lastEventId?: string | undefined;
  signal: AbortSignal;
  onEvent: (event: LiveEvent) => void;
  /** Called once the server has accepted the stream (a 200 response). */
  onOpen?: (() => void) | undefined;
}

/** A line-based SSE parser: feed it text as it arrives. Comments (`: hb`) are ignored; `id:` sticks until changed. */
export function createSseParser(onEvent: (event: LiveEvent) => void): { push(chunk: string): void } {
  let buffer = "";
  let type = "";
  let data: string[] = [];
  let id: string | undefined;

  function dispatch(): void {
    if (data.length > 0 || type !== "") {
      const text = data.join("\n");
      let parsed: unknown = text === "" ? null : text;
      if (text !== "") {
        try {
          parsed = JSON.parse(text);
        } catch {
          // Plain text stays text.
        }
      }
      onEvent({ type: type === "" ? "message" : type, ...(id === undefined ? {} : { id }), data: parsed });
    }
    type = "";
    data = [];
  }

  function line(text: string): void {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") type = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }

  return {
    push(chunk) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      const eol = /\r\n|\n|\r/;
      while ((match = eol.exec(buffer)) !== null) {
        // A lone `\r` at the very end may be the first half of `\r\n`: wait for more.
        if (match[0] === "\r" && match.index === buffer.length - 1) break;
        const text = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        line(text);
      }
    },
  };
}
