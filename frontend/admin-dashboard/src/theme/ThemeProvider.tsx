import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "karnexTheme";
/** Legacy / vanilla HR shell (`frontend/index.html`) uses this key + `kx-dark` on `<html>`. */
const LEGACY_UI_DARK_KEY = "karnexUiDark";

export type ThemeMode = "light" | "dark";

type Ctx = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

/**
 * Resolution order: primary key -> legacy key -> system preference.
 * Must stay in lockstep with the pre-hydration script in index.html so the
 * first painted theme never flips after React mounts.
 */
function readStored(): ThemeMode {
  try {
    const v = String(window.localStorage.getItem(STORAGE_KEY) || "").toLowerCase();
    if (v === "dark" || v === "light") return v === "dark" ? "dark" : "light";
    const legacy = window.localStorage.getItem(LEGACY_UI_DARK_KEY);
    if (legacy === "1") return "dark";
    if (legacy === "0") return "light";
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function applyDom(theme: ThemeMode) {
  const root = document.documentElement;
  const on = theme === "dark";
  root.classList.toggle("dark", on);
  root.classList.toggle("kx-dark", on);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
    window.localStorage.setItem(LEGACY_UI_DARK_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStored());

  useEffect(() => {
    applyDom(theme);
  }, [theme]);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    applyDom(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyDom(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}
