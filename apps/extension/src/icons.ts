// Lucide SVGs (ISC-licensed) are bundled through ?raw, avoiding runtime fetches and host CSP.
// content.css controls size, stroke, and currentColor.
import externalLink from "lucide-static/icons/external-link.svg?raw";
import eye from "lucide-static/icons/eye.svg?raw";
import eyeOff from "lucide-static/icons/eye-off.svg?raw";
import star from "lucide-static/icons/star.svg?raw";
import repeat from "lucide-static/icons/repeat.svg?raw";
import history from "lucide-static/icons/history.svg?raw";
import ban from "lucide-static/icons/ban.svg?raw";
import x from "lucide-static/icons/x.svg?raw";
import contrast from "lucide-static/icons/contrast.svg?raw";
import monitor from "lucide-static/icons/monitor.svg?raw";
import sun from "lucide-static/icons/sun.svg?raw";
import moon from "lucide-static/icons/moon.svg?raw";
import pencil from "lucide-static/icons/pencil.svg?raw";
import stickyNote from "lucide-static/icons/sticky-note.svg?raw";
import settings from "lucide-static/icons/settings.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import check from "lucide-static/icons/check.svg?raw";
import rotateCcw from "lucide-static/icons/rotate-ccw.svg?raw";

export const ICON = {
  open: externalLink,
  eye, // job is hidden → offer to reveal
  eyeOff, // job is visible → offer to hide
  star,
  repeat, // possible-duplicate badge
  history, // previous-applications-to-this-company badge
  ban, // block company
  x, // dismiss from site
  contrast, // popup: "dimmed" hide-mode
  monitor, // popup theme: follow system
  sun, // popup theme: light
  moon, // popup theme: dark
  pencil, // popup detail: edit the current status' comment
  stickyNote, // popup detail: add a standalone note
  settings, // popup: open the settings panel
  copy, // detail banner: copy the JD (with title/company/url) for an AI prompt
  arrowUp,
  check,
  rotateCcw,
} as const;
