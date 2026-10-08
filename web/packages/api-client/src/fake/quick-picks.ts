/** The fake API's quick picks: specialties/dental/quick-picks.json itself, checked against the API's shape on load. */

import source from "../../../../../specialties/dental/quick-picks.json" with { type: "json" };

import { quickPicks, type QuickPicks } from "../schemas.js";

export const QUICK_PICKS: QuickPicks = quickPicks.parse(source);
