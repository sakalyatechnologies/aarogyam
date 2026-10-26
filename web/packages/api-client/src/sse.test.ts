import { describe, expect, it } from "vitest";

import { createSseParser, type LiveEvent } from "./sse.js";

function parse(...chunks: string[]): LiveEvent[] {
  const seen: LiveEvent[] = [];
  const parser = createSseParser((e) => seen.push(e));
  for (const chunk of chunks) parser.push(chunk);
  return seen;
}

describe("createSseParser", () => {
  it("reads a typed event with an id and JSON data", () => {
    expect(parse('id: 7\nevent: queue.changed\ndata: {"kind":"queue_token","id":"a"}\n\n')).toEqual([
      { type: "queue.changed", id: "7", data: { kind: "queue_token", id: "a" } },
    ]);
  });

  it("joins multi-line data and ignores comments", () => {
    expect(parse(": hb\n\nevent: x\ndata: one\ndata: two\n\n")).toEqual([{ type: "x", data: "one\ntwo" }]);
  });

  it("copes with chunks split anywhere and CRLF", () => {
    const events = parse("event: rea", "dy\r\ndata: {}\r", "\n\r\nid: 2\nevent: resync\ndata: {}\n", "\n");
    expect(events).toEqual([
      { type: "ready", data: {} },
      { type: "resync", id: "2", data: {} },
    ]);
  });

  it("keeps the last id for later events", () => {
    const events = parse("id: 1\nevent: a\ndata: {}\n\nevent: b\ndata: {}\n\n");
    expect(events.map((e) => e.id)).toEqual(["1", "1"]);
  });
});
