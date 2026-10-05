import { CalendarPlus, Check, Copy, Globe } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { useToast } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";

/** The last screen: the clinic is ready, with three things to do next. */
export function ReadyStep() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const bookingLink = `${window.location.origin}/book`;
  const copy = () => {
    navigator.clipboard.writeText(bookingLink).then(
      () => {
        setCopied(true);
        toast.show({ title: "Booking link copied", tone: "success" });
      },
      () => {
        toast.show({ title: "Couldn't copy. Select the link and copy it by hand.", tone: "danger" });
      },
    );
  };
  return (
    <MkCard>
      <div className="sw-ready">
        <h2>Your clinic is ready</h2>
        <p>Everything you skipped is still there in Settings. Here is where most clinics go next.</p>
        <div className="sw-next">
          <div>
            <span>
              <b>Book your first appointment</b>
              <p>Put a patient on the calendar and see the day take shape.</p>
            </span>
            <Link className="mk-btn mk-btn-primary" to="/calendar">
              <CalendarPlus aria-hidden="true" /> Open the calendar
            </Link>
          </div>
          <div>
            <span>
              <b>Set up your website</b>
              <p>Pick a design and add your story in Settings &rarr; Website.</p>
            </span>
            <Link className="mk-btn mk-btn-ghost" to="/settings">
              <Globe aria-hidden="true" /> Go to Settings
            </Link>
          </div>
          <div>
            <span>
              <b>Share your booking link</b>
              <p>Patients pick a time themselves.</p>
              <code className="sw-link-box">{bookingLink}</code>
            </span>
            <button type="button" className="mk-btn mk-btn-ghost" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
        <div className="sw-foot" style={{ justifyContent: "center", borderTop: 0 }}>
          <Link className="mk-btn mk-btn-ghost" to="/today">
            Go to Today
          </Link>
        </div>
      </div>
    </MkCard>
  );
}
