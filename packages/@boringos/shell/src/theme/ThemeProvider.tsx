// SPDX-License-Identifier: BUSL-1.1
//
// ThemeProvider — light / dark / system Shell theme.
//
// Persistence: localStorage key `boringos.theme` holds the user's
// declared preference ("light" | "dark" | "system"). When the
// preference is "system", the effective theme follows
// `prefers-color-scheme`. A small inline script in index.html sets
// `data-theme` on <html> before React mounts to avoid a flash of
// unstyled content; this provider keeps that attribute in sync after
// boot and reacts to OS / cross-tab changes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

interface ThemeContextValue {
  /** What the user picked. */
  preference: ThemePreference;
  /** What's actually applied right now ("system" resolved to light|dark). */
  effectiveTheme: EffectiveTheme;
  /** Persist a new preference and apply it immediately. */
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_STORAGE_KEY = "boringos.theme";

function isThemePreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveEffective(pref: ThemePreference): EffectiveTheme {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

function applyToDocument(effective: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", effective);
  // colorScheme tells the UA to use matching native form widgets,
  // scrollbars, etc.
  document.documentElement.style.colorScheme = effective;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => readStoredPreference(),
  );
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(
    () => resolveEffective(readStoredPreference()),
  );

  // Apply on mount + whenever the resolved theme changes.
  useEffect(() => {
    applyToDocument(effectiveTheme);
  }, [effectiveTheme]);

  // Track system preference when in "system" mode.
  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setEffectiveTheme(e.matches ? "dark" : "light");
    };
    // Set once on subscribe (covers the case where OS changed between
    // render and effect mount).
    setEffectiveTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  // Sync across tabs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = isThemePreference(e.newValue) ? e.newValue : "system";
      setPreferenceState(next);
      setEffectiveTheme(resolveEffective(next));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    setEffectiveTheme(resolveEffective(next));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage may be disabled; silently ignore — in-memory state
      // still applies for this session.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, effectiveTheme, setPreference }),
    [preference, effectiveTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Allow useTheme() outside the provider — return a no-op shape so
    // tests / scaffolders importing components in isolation still work.
    return {
      preference: "system",
      effectiveTheme: "light",
      setPreference: () => {
        // no-op outside provider
      },
    };
  }
  return ctx;
}
