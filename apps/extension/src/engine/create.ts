// Concern factories keep state in closures and contribute methods to one Engine.
// Late-bound engine.* calls allow mutual recursion without import cycles; each instance is isolated.
import type { Engine } from "./types.js";
import { createBridge } from "./bridge.js";
import { createReadModel } from "./readModel.js";
import { createStatusSelect } from "./statusSelect.js";
import { createBars } from "./bars.js";
import { createBlocklist } from "./blocklist.js";
import { createCapture } from "./capture.js";
import { createMatches } from "./matches.js";
import { createMenu } from "./menu.js";
import { createOffline } from "./offline.js";
import { createScan } from "./scan.js";

export function createEngine(): Engine {
  const engine = {} as Engine;
  Object.assign(
    engine,
    createBridge(engine),
    createReadModel(engine),
    createStatusSelect(engine),
    createBars(engine),
    createBlocklist(engine),
    createCapture(engine),
    createMatches(engine),
    createMenu(engine),
    createOffline(engine),
    createScan(engine),
  );
  return engine;
}
