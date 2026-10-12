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

// Blocked storage must not break in-memory view preferences.
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

// Persist only preference IDs; empty defaults keep all sections expanded.
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
