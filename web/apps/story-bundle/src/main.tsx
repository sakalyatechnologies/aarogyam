// The phone story bundle's entry: installs `window.aarogyam` and posts `ready`. Present, 3D,
// "How to brush" art and the video encoder each load from their own chunk when first used.
import "@aarogyam/app-kit/mouth-view.css";
import "@aarogyam/app-kit/hold-to-exit.css";
import "@aarogyam/app-kit/present.css";
import "./story-bundle.css";

import { installBridge } from "./bridge.js";

const container = document.getElementById("root");
if (container !== null) installBridge({ container });
