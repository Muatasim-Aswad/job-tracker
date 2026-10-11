import { useEffect, useState } from "react";

export function readPersistentChoice<T extends string>(
  key: string,
  choices: readonly T[],
  initial: T,
): T {
  try {
    const stored = localStorage.getItem(key);
    return stored != null && choices.includes(stored as T) ? (stored as T) : initial;
  } catch {
    return initial;
  }
}

// A localStorage-backed string union. Invalid or obsolete stored values fall
// back to the supplied default instead of leaking an unchecked string into the
// caller's typed preference model.
export function usePersistentChoice<T extends string>(
  key: string,
  choices: readonly T[],
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    return readPersistentChoice(key, choices, initial);
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore write failures (private mode / disabled storage).
    }
  }, [key, value]);

  return [value, setValue];
}
