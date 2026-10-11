import { useEffect, useState } from "react";

export function readPersistentBoolean(key: string, initial: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === "true" ? true : stored === "false" ? false : initial;
  } catch {
    return initial;
  }
}

export function persistPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be disabled.
  }
}

// A boolean useState mirrored to localStorage, so a view preference like "hide
// hidden" survives reloads. No SSR guard is needed in a client-only SPA, but reads
// are wrapped so a blocked or disabled localStorage never throws.
export function usePersistentBoolean(
  key: string,
  initial: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    return readPersistentBoolean(key, initial);
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // ignore write failures (private mode / disabled storage)
    }
  }, [key, value]);

  return [value, setValue];
}

// A set of string ids mirrored to localStorage as a JSON array, with a toggle that
// flips membership. Backs view preferences that are a collection of things turned
// on/off rather than a single flag, like which board columns are collapsed. Empty by
// default, so nothing is collapsed on first load.
export function usePersistentStringSet(key: string): [Set<string>, (value: string) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(key);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify([...set]));
    } catch {
      // ignore write failures (private mode / disabled storage)
    }
  }, [key, set]);

  const toggle = (value: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  return [set, toggle];
}
