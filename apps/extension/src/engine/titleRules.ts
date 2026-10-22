import { SERVER_URL } from "../config.js";
import { toNaturalKey } from "../registry.js";
import { canSkip } from "./bars.js";
import { getPolicyRevision, matchingTitleRules } from "./keywords.js";
import type { Engine } from "./types.js";

export async function applyTitleRules(engine: Engine, cards: HTMLElement[]): Promise<void> {
  const server = SERVER_URL;
  const revision = getPolicyRevision();
  for (const card of cards) {
    const id = card.dataset.jhId!;
    if (!toNaturalKey(id) || engine.isCardBlocked(card)) continue;
    const rules = matchingTitleRules(card.dataset.jobTitle || "");
    for (const rule of rules) {
      if (server !== SERVER_URL || revision !== getPolicyRevision()) return;
      const state = engine.stateOf(id);
      const event =
        rule.action === "hide"
          ? !state.hidden
            ? "hidden"
            : null
          : rule.action === "star"
            ? !state.starred
              ? "starred"
              : null
            : rule.action === "skip" && canSkip(state.status)
              ? "skipped"
              : null;
      if (!event) continue;
      engine.captureCardFromAction(card);
      await engine.autoEmit(id, event);
    }
  }
}
