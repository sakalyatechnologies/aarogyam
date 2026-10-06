/**
 * The strict Markdown subset clinical text is stored in: headings (`#` to `###`), bullet and
 * numbered lists, `**bold**` and `*italic*` (or `_italic_`). Anything else is literal text.
 *
 * The parser returns a small tree that React renders as elements (never as HTML strings), so
 * there is nothing to sanitise away: a `<script>` in the text is shown as the characters it is.
 * `validateMarkdown` mirrors the API's rules (`aarogyam-domain/src/richtext.rs`) so the editor
 * can refuse what the API would.
 */

export type Inline = { type: "text"; text: string } | { type: "bold"; children: Inline[] } | { type: "italic"; children: Inline[] } | { type: "break" };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "bullets"; items: Inline[][] }
  | { type: "numbers"; items: Inline[][] };

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** Parses one line or paragraph into text, bold and italic runs. Unmatched markers stay as text. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") {
      out.push({ type: "text", text });
      text = "";
    }
  };
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === "*" && source[i + 1] === "*") {
      const close = source.indexOf("**", i + 2);
      if (close > i + 2) {
        flush();
        out.push({ type: "bold", children: parseInline(source.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    if (char === "*" && source[i + 1] !== undefined && source[i + 1] !== " " && source[i + 1] !== "*") {
      const close = source.indexOf("*", i + 1);
      if (close > i + 1 && source[close - 1] !== " " && source[close + 1] !== "*") {
        flush();
        out.push({ type: "italic", children: parseInline(source.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    if (char === "_" && !isWordChar(source[i - 1]) && source[i + 1] !== undefined && source[i + 1] !== " ") {
      let close = source.indexOf("_", i + 1);
      while (close !== -1 && isWordChar(source[close + 1])) {
        close = source.indexOf("_", close + 1);
      }
      if (close > i + 1 && source[close - 1] !== " ") {
        flush();
        out.push({ type: "italic", children: parseInline(source.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    text += char;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,3})\s+(\S.*)$/;
const BULLET = /^[-*]\s+(\S.*)$/;
const NUMBER = /^\d{1,3}[.)]\s+(\S.*)$/;

/** Parses stored text into blocks. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const children: Inline[] = [];
    paragraph.forEach((line, index) => {
      if (index > 0) {
        children.push({ type: "break" });
      }
      children.push(...parseInline(line));
    });
    blocks.push({ type: "paragraph", children });
    paragraph = [];
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (line === "") {
      endParagraph();
    } else if (heading !== null) {
      endParagraph();
      blocks.push({ type: "heading", level: heading[1]?.length === 1 ? 1 : heading[1]?.length === 2 ? 2 : 3, children: parseInline(heading[2] ?? "") });
    } else if (bullet !== null || number !== null) {
      endParagraph();
      const kind = bullet !== null ? "bullets" : "numbers";
      const item = parseInline((bullet ?? number)?.[1] ?? "");
      const last = blocks[blocks.length - 1];
      if (last?.type === kind) {
        last.items.push(item);
      } else {
        blocks.push({ type: kind, items: [item] });
      }
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  return blocks;
}

/**
 * What the API refuses on save: raw HTML (`<` before a letter, `/`, `!` or `?`), images, links,
 * code and headings deeper than level 3. Returns a message, or `undefined` when the text is fine.
 */
export function validateMarkdown(text: string): string | undefined {
  if (/<[A-Za-z/!?]/.test(text)) {
    return "HTML isn't allowed. Use the toolbar for headings, lists, bold and italic.";
  }
  if (/!\[/.test(text) || /\]\(/.test(text)) {
    return "Links and images aren't allowed.";
  }
  if (text.includes("`")) {
    return "Code formatting isn't allowed.";
  }
  if (/^\s*#{4,}\s/m.test(text)) {
    return "Headings go down to three levels (###).";
  }
  return undefined;
}

export type FormatKind = "heading" | "bold" | "italic" | "bullets" | "numbers";

export interface FormatResult {
  value: string;
  start: number;
  end: number;
}

function wrap(value: string, start: number, end: number, mark: string): FormatResult {
  const before = value.slice(Math.max(0, start - mark.length), start);
  const after = value.slice(end, end + mark.length);
  if (before === mark && after === mark) {
    return { value: value.slice(0, start - mark.length) + value.slice(start, end) + value.slice(end + mark.length), start: start - mark.length, end: end - mark.length };
  }
  return { value: value.slice(0, start) + mark + value.slice(start, end) + mark + value.slice(end), start: start + mark.length, end: end + mark.length };
}

/** Applies a toolbar action to the selection (or the lines it touches) and says where the selection ends up. */
export function applyFormat(value: string, start: number, end: number, kind: FormatKind): FormatResult {
  if (kind === "bold") {
    return wrap(value, start, end, "**");
  }
  if (kind === "italic") {
    return wrap(value, start, end, "*");
  }
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  let changed: string[];
  if (kind === "heading") {
    changed = lines.map((line) => (/^##\s/.test(line) ? line.replace(/^##\s+/, "") : `## ${line.replace(/^#{1,6}\s+/, "")}`));
  } else {
    const marker = kind === "bullets" ? /^[-*]\s+/ : /^\d{1,3}[.)]\s+/;
    const every = lines.every((line) => marker.test(line));
    changed = lines.map((line, index) => {
      const bare = line.replace(/^([-*]|\d{1,3}[.)])\s+/, "");
      return every ? bare : kind === "bullets" ? `- ${bare}` : `${String(index + 1)}. ${bare}`;
    });
  }
  const replaced = changed.join("\n");
  return { value: value.slice(0, lineStart) + replaced + value.slice(lineEnd), start: lineStart, end: lineStart + replaced.length };
}
