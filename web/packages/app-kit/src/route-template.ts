/**
 * The page's route template, such as `/patients/:id`, from the router's matched patterns: never
 * the URL, so no ID, name or query leaves the page through telemetry or error reports.
 */

/** The part of a react-router match this needs. */
export interface RouteMatchLike {
  route: { path?: string | undefined };
}

/** The part of a react-router data router this needs. */
export interface TemplateRouter {
  state: { matches: readonly RouteMatchLike[] };
  subscribe: (listener: (state: { matches: readonly RouteMatchLike[] }) => void) => () => void;
}

/** Joins the matched patterns: `["/", "patients/:id"]` is `/patients/:id`; no match is `/`. */
export function routeTemplate(matches: readonly RouteMatchLike[]): string {
  const segments = matches.flatMap((match) => (match.route.path ?? "").split("/")).filter((segment) => segment !== "");
  return `/${segments.join("/")}`;
}

/** Before a router exists (errors while the app starts). */
const BEFORE_ROUTER = "/boot";
let current = BEFORE_ROUTER;

/** The template of the page showing now, as the last watched router matched it. */
export function currentRouteTemplate(): string {
  return current;
}

/** Keeps `currentRouteTemplate()` in step with `router`. Returns a function that stops it. */
export function watchRouteTemplate(router: TemplateRouter): () => void {
  current = routeTemplate(router.state.matches);
  const unsubscribe = router.subscribe((state) => {
    current = routeTemplate(state.matches);
  });
  return () => {
    unsubscribe();
    current = BEFORE_ROUTER;
  };
}
