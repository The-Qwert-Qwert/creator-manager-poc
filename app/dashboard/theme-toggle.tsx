"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "creator-analytics-theme";

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function subscribeToTheme(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function selectTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.cookie = `creator-analytics-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      <button
        type="button"
        className="theme-option"
        data-active={theme === "light"}
        aria-pressed={theme === "light"}
        aria-label="Use light theme"
        onClick={() => selectTheme("light")}
      >
        <Sun aria-hidden="true" size={14} strokeWidth={2} />
        <span className="theme-option-label">Light</span>
      </button>
      <button
        type="button"
        className="theme-option"
        data-active={theme === "dark"}
        aria-pressed={theme === "dark"}
        aria-label="Use dark theme"
        onClick={() => selectTheme("dark")}
      >
        <Moon aria-hidden="true" size={14} strokeWidth={2} />
        <span className="theme-option-label">Dark</span>
      </button>
    </div>
  );
}
