import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";

import { LinkProvider, type RenderLink } from "@sakalya/ui";

/** Renders every @sakalya/ui link with React Router, so navigation never reloads the app. */
export const renderRouterLink: RenderLink = ({ href, ...props }) => <RouterLink to={href} {...props} />;

/** Wrap route content in this (inside the router) so library links outside the shell route in-app too. */
export function RouterLinks({ children }: { children: ReactNode }) {
  return <LinkProvider renderLink={renderRouterLink}>{children}</LinkProvider>;
}
