import { useCallback, useEffect, useState } from "react";

// Explicit preferences override the system; keep the pre-paint index.html rule in sync.

export type ThemePref = "system" | "light" | "dark";

const KEY = "jt.theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function resolveDark(pref: ThemePref): boolean {
  return pref === "dark" || (pref === "system" && systemPrefersDark());
}

function apply(pref: ThemePref): void {
  document.documentElement.classList.toggle("dark", resolveDark(pref));
}

function persist(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // ignore write failures (private mode / disabled storage)
  }
}

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

export function useTheme(): { pref: ThemePref; cycle: () => void } {
  const [pref, setPref] = useState<ThemePref>(readThemePref);

  useEffect(() => {
    apply(pref);
    persist(pref);
  }, [pref]);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  // Stable callbacks avoid repeated effect subscriptions.
  const cycle = useCallback(() => setPref((p) => NEXT[p]), []);
  return { pref, cycle };
}
