// Stable, site-agnostic adapter surface backed by one engine per content document.
import { createEngine } from "./engine/create.js";

// Keep adapters independent of the engine's internal module layout.
export { toNaturalKey } from "./registry.js";
export {
  type BannerChip,
  detailText,
  elementToText,
  bannerCurrent,
  bannerFingerprint,
  bannerSignature,
  placeBanner,
} from "./engine/dom.js";
export { keywordFindings } from "./engine/keywords.js";

// One engine instance owns each content document; tests can create isolated instances.
const engine = createEngine();

export const stateOf = engine.stateOf;
export const emit = engine.emit;
export const autoEmit = engine.autoEmit;
export const refreshStates = engine.refreshStates;
export const isCompanyBlocked = engine.isCompanyBlocked;
export const renderJob = engine.renderJob;
export const toggleHidden = engine.toggleHidden;
export const injectDetailButtons = engine.injectDetailButtons;
export const checkMatches = engine.checkMatches;
export const closeMatchPopover = engine.closeMatchPopover;
export const markListingClosed = engine.markListingClosed;
export const captureListingOnce = engine.captureListingOnce;
export const captureCards = engine.captureCards;
export const start = engine.start;
