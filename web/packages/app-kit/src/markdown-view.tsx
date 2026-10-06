import type { ReactNode } from "react";

import { parseMarkdown, type Block, type Inline } from "./markdown.js";

function inlines(items: readonly Inline[]): ReactNode[] {
  return items.map((item, index) => {
    switch (item.type) {
      case "text":
        return item.text;
      case "break":
        return <br key={index} />;
      case "bold":
        return <strong key={index}>{inlines(item.children)}</strong>;
      case "italic":
        return <em key={index}>{inlines(item.children)}</em>;
    }
  });
}

const HEADING_CLASS = { 1: "text-lg font-bold", 2: "text-base font-bold", 3: "text-sm font-bold" } as const;

function block(item: Block, index: number): ReactNode {
  switch (item.type) {
    case "heading": {
      const className = `${HEADING_CLASS[item.level]} text-text`;
      return item.level === 1 ? (
        <h3 key={index} className={className}>
          {inlines(item.children)}
        </h3>
      ) : item.level === 2 ? (
        <h4 key={index} className={className}>
          {inlines(item.children)}
        </h4>
      ) : (
        <h5 key={index} className={className}>
          {inlines(item.children)}
        </h5>
      );
    }
    case "paragraph":
      return <p key={index}>{inlines(item.children)}</p>;
    case "bullets":
      return (
        <ul key={index} className="list-disc pl-5">
          {item.items.map((entry, at) => (
            <li key={at}>{inlines(entry)}</li>
          ))}
        </ul>
      );
    case "numbers":
      return (
        <ol key={index} className="list-decimal pl-5">
          {item.items.map((entry, at) => (
            <li key={at}>{inlines(entry)}</li>
          ))}
        </ol>
      );
  }
}

/**
 * Renders stored clinical text. Everything becomes React elements; text is escaped by React and
 * there is no HTML path, so markup typed into a note is shown as plain characters.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`flex flex-col gap-1.5 text-sm text-text [overflow-wrap:anywhere] ${className ?? ""}`}>{parseMarkdown(text).map(block)}</div>;
}
