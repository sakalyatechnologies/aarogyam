import { CircleHelp } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { Link } from "react-router";

import { Drawer } from "@sakalya/ui";

import "./guide-help.css";

// The player stays out of the page's own chunk until someone opens the sheet.
const GuideLoader = lazy(async () => ({ default: (await import("./guide-loader.js")).GuideLoader }));

/** A small "?" for a page header: opens the matching guide in a side sheet. */
export function GuideHelp({ id, label = "Watch the guide for this page" }: { id: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="gh-btn"
        aria-label={label}
        title={label}
        onClick={() => {
          setOpen(true);
        }}
      >
        <CircleHelp aria-hidden="true" />
      </button>
      {open ? (
        <Drawer open onOpenChange={setOpen} title="Guide" size="lg" description="A short narrated walk-through.">
          <div className="gh-sheet">
            <Suspense fallback={<p role="status">Loading the guide…</p>}>
              <GuideLoader id={id} />
            </Suspense>
            <Link to="/guides" className="gh-all" onClick={() => { setOpen(false); }}>
              All guides
            </Link>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
