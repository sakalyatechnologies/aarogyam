import { Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

import type { SitePage } from "@aarogyam/api-client";
import { ClinicSite, PAGES, type EditApi, type PageId } from "@aarogyam/site-kit";
import "@aarogyam/site-kit/styles.css";

export type Device = "desktop" | "phone";

const PAGE_LABELS: Record<PageId, string> = { home: "Home", about: "About", services: "Services", gallery: "Gallery", contact: "Contact" };

/**
 * The site as patients will see it, drawn by the same code as the live site, with text and
 * pictures editable in place. A phone preview is a narrow box: the design adapts to the width
 * of the box it sits in, not to the browser window.
 */
export function SitePreview({ site, edit }: { site: SitePage; edit: EditApi }) {
  const [device, setDevice] = useState<Device>("desktop");
  const [page, setPage] = useState<PageId>("home");
  const multi = site.design.layout === "multi";
  const bookingUrl = useMemo(() => `${window.location.origin}/book`, []);
  return (
    <div className="wb-preview">
      <div className="wb-preview-bar">
        <div role="group" aria-label="Preview size" className="wb-seg">
          {(
            [
              ["desktop", "Desktop", Monitor],
              ["phone", "Phone", Smartphone],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={device === value}
              onClick={() => {
                setDevice(value);
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        {multi && (
          <div role="group" aria-label="Page to preview" className="wb-seg">
            {PAGES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={page === p}
                onClick={() => {
                  setPage(p);
                }}
              >
                {PAGE_LABELS[p]}
              </button>
            ))}
          </div>
        )}
        <p className="wb-hint">Click any text to edit it. Pictures have their own buttons.</p>
      </div>
      <div className={`wb-frame is-${device}`}>
        <div className="wb-scroll" tabIndex={-1}>
          <ClinicSite site={site} page={page} onNavigate={setPage} bookingUrl={bookingUrl} edit={edit} />
        </div>
      </div>
    </div>
  );
}
