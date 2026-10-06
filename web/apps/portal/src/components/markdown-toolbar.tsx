import { Bold, Heading2, Italic, List, ListOrdered } from "lucide-react";
import type { ReactNode } from "react";

import { applyFormat, type FormatKind, type FormatResult } from "@aarogyam/app-kit";

const ACTIONS: readonly { kind: FormatKind; label: string; icon: ReactNode }[] = [
  { kind: "heading", label: "Heading", icon: <Heading2 aria-hidden="true" className="size-4" /> },
  { kind: "bold", label: "Bold", icon: <Bold aria-hidden="true" className="size-4" /> },
  { kind: "italic", label: "Italic", icon: <Italic aria-hidden="true" className="size-4" /> },
  { kind: "bullets", label: "Bulleted list", icon: <List aria-hidden="true" className="size-4" /> },
  { kind: "numbers", label: "Numbered list", icon: <ListOrdered aria-hidden="true" className="size-4" /> },
];

/**
 * A small toolbar above a text box holding the Markdown subset: heading, bold, italic, bullets
 * and numbers. It reads the box's selection, applies the change to `value` and hands back the
 * new text and where the selection should be.
 */
export function MarkdownToolbar({
  label,
  value,
  box,
  onApply,
}: {
  /** Names the box this toolbar controls, for screen readers. */
  label: string;
  value: string;
  box: () => HTMLTextAreaElement | null | undefined;
  onApply: (result: FormatResult) => void;
}) {
  return (
    <div role="toolbar" aria-label={`Formatting for ${label}`} className="flex flex-wrap gap-1">
      {ACTIONS.map(({ kind, label: action, icon }) => (
        <button
          key={kind}
          type="button"
          title={action}
          aria-label={action}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted hover:bg-surface-muted hover:text-text"
          // Keep the selection in the box while the button is pressed.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            const element = box();
            const start = element?.selectionStart ?? value.length;
            const end = element?.selectionEnd ?? value.length;
            onApply(applyFormat(value, start, end, kind));
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
