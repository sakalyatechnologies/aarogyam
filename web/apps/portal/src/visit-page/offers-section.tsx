/** The patient's offers and "Share with a friend" on the visit page (offers design 2.5). The
 * share text carries the code in the text only: never a wa.me or any other URL with the code. */
import { useState } from "react";

import type { Visit } from "./public-client.js";
import { dayWords } from "./words.js";

export function OffersSection({ visit }: { visit: Visit }) {
  const [note, setNote] = useState("");
  const { offers, referral } = visit;
  if (offers.length === 0 && referral === undefined) return null;

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = async (text: string) => {
    try {
      if (canShare) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setNote("Message copied. Paste it to your friend.");
    } catch {
      // A cancelled share sheet is not an error.
    }
  };

  return (
    <section className="vp-card vp-reveal" aria-label="Your offers">
      <h2 className="vp-h2">Your offers</h2>
      <ul className="vp-steps">
        {offers.map((offer) => (
          <li key={offer.code}>
            <strong>{offer.words ?? "An offer"}</strong> on {offer.target ?? "the next treatment"}
            <br />
            Show code <strong>{offer.code}</strong> at the clinic · valid till {dayWords(offer.validTo)}
          </li>
        ))}
      </ul>
      {referral === undefined ? null : (
        <div>
          <h3 className="vp-care-title">Share with a friend</h3>
          <p className="vp-muted">
            Your friend gets {referral.words ?? "an offer"} on their first visit, valid till {dayWords(referral.validTo)}.
          </p>
          {referral.shareText === null || referral.shareText === undefined ? null : (
            <button type="button" className="vp-btn" onClick={() => void share(referral.shareText ?? "")}>
              {canShare ? "Share with a friend" : "Copy message"}
            </button>
          )}
          {note === "" ? null : (
            <p className="vp-muted" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
