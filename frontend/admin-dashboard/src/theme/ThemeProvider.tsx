import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import "./accents.css";

const STORAGE_KEY = "karnexTheme";
/** Legacy / vanilla HR shell (`frontend/index.html`) uses this key + `kx-dark` on `<html>`. */
const LEGACY_UI_DARK_KEY = "karnexUiDark";
const ACCENT_STORAGE_KEY = "karnexAccent";

export type ThemeMode = "light" | "dark";

export type AccentId =
  | "indigo"
  | "blue"
  | "teal"
  | "emerald"
  | "amber"
  | "rose"
  | "fuchsia"
  | "multi";

export type AccentOption = {
  id: AccentId;
  label: string;
  /** Swatch fill — solid color or CSS gradient */
  swatch: string;
};

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: "indigo", label: "Indigo", swatch: "#6366f1" },
  { id: "blue", label: "Blue", swatch: "#3b82f6" },
  { id: "teal", label: "Teal", swatch: "#14b8a6" },
  { id: "emerald", label: "Emerald", swatch: "#10b981" },
  { id: "amber", label: "Amber", swatch: "#f59e0b" },
  { id: "rose", label: "Rose", swatch: "#f43f5e" },
  { id: "fuchsia", label: "Fuchsia", swatch: "#d946ef" },
  {
    id: "multi",
    label: "Multi",
    swatch: "linear-gradient(135deg, #f59e0b 0%, #ef4444 22%, #ec4899 45%, #8b5cf6 68%, #06b6d4 88%, #22c55e 100%)",
  },
];

const ACCENT_IDS = new Set<string>(ACCENT_OPTIONS.map((o) => o.id));

type Ctx = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  accent: AccentId;
  setAccent: (a: AccentId) => void;
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

function readStoredAccent(): AccentId {
  try {
    const v = String(window.localStorage.getItem(ACCENT_STORAGE_KEY) || "").toLowerCase();
    if (ACCENT_IDS.has(v)) return v as AccentId;
  } catch {
    /* ignore */
  }
  return "indigo";
}

function applyDom(theme: ThemeMode, accent: AccentId) {
  const root = document.documentElement;
  const on = theme === "dark";
  root.classList.toggle("dark", on);
  root.classList.toggle("kx-dark", on);
  if (accent === "indigo") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", accent);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
    window.localStorage.setItem(LEGACY_UI_DARK_KEY, on ? "1" : "0");
    window.localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStored());
  const [accent, setAccentState] = useState<AccentId>(() => readStoredAccent());

  useEffect(() => {
    applyDom(theme, accent);
  }, [theme, accent]);

  const setTheme = useCallback(
    (t: ThemeMode) => {
      setThemeState(t);
      applyDom(t, accent);
    },
    [accent],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyDom(next, accent);
      return next;
    });
  }, [accent]);

  const setAccent = useCallback(
    (a: AccentId) => {
      setAccentState(a);
      applyDom(theme, a);
    },
    [theme],
  );

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, accent, setAccent }),
    [theme, setTheme, toggleTheme, accent, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}
