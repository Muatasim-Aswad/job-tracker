import { startEasyApplyFormFill } from "./scanner.js";

const frame = window as Window & { __jobTrackerEasyApplyBooted?: boolean };
if (!frame.__jobTrackerEasyApplyBooted) {
  frame.__jobTrackerEasyApplyBooted = true;
  startEasyApplyFormFill();
}

// A named export keeps this all-frame entry distinct from the top-frame wrapper
// under CRXJS/Rolldown's exports-only entry preservation.
export const easyApplyContentEntry = true;
