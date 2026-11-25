import { ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";

import { GuideLoader } from "./guide-loader.js";
import "./guides.css";

/** /guides/:id: one guide in the player. */
export function GuidePage() {
  const { id = "" } = useParams();
  useDocumentTitle("Guides");
  return (
    <div className="mk-panel gp-page">
      <Link to="/guides" className="gp-back">
        <ChevronLeft aria-hidden="true" /> All guides
      </Link>
      <GuideLoader id={id} />
    </div>
  );
}
