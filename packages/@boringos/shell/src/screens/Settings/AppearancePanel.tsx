// SPDX-License-Identifier: BUSL-1.1
//
// Appearance settings — light / dark / system theme picker.
// Preference is stored in localStorage by ThemeProvider; this panel
// is a thin shell around useTheme() so the toggle stays in sync with
// keyboard shortcuts, OS changes, and cross-tab updates.

import { useTheme, type ThemePreference } from "../../theme/index.js";

interface ThemeOption {
  id: ThemePreference;
  label: string;
  description: string;
  preview: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    accent: string;
  };
}

const OPTIONS: ThemeOption[] = [
  {
    id: "system",
    label: "System",
    description: "Match your OS preference. Updates live when you change it.",
    preview: {
      bg: "linear-gradient(135deg, #F8F6F1 50%, #0B0E14 50%)",
      surface: "#FFFFFF",
      border: "#E6E1D6",
      text: "#0B1220",
      accent: "var(--color-accent)",
    },
  },
  {
    id: "light",
    label: "Light",
    description: "The default Notion-inspired warm-paper canvas.",
    preview: {
      bg: "#F8F6F1",
      surface: "#FFFFFF",
      border: "#E6E1D6",
      text: "#0B1220",
      accent: "var(--color-accent)",
    },
  },
  {
    id: "dark",
    label: "Dark",
    description: "Ink-deep canvas for long sessions and OLED screens.",
    preview: {
      bg: "#0B0E14",
      surface: "#172038",
      border: "#1F2937",
      text: "#E5E7EB",
      accent: "var(--color-accent)",
    },
  },
];

export function AppearancePanel() {
  const { preference, effectiveTheme, setPreference } = useTheme();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-medium text-text">Theme</h2>
        <p className="mt-1 text-sm text-muted-strong">
          Pick how the Shell renders for your account. The choice is saved on
          this device and respected across tabs. Default is System, which
          follows your operating system.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Theme preference"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        {OPTIONS.map((opt) => {
          const selected = preference === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(opt.id)}
              className={`text-left rounded-lg border p-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                selected
                  ? "border-accent bg-accent-tint"
                  : "border-border hover:bg-bg-warm"
              }`}
            >
              <ThemePreview preview={opt.preview} />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-sm font-medium text-text">{opt.label}</div>
                {selected && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-accent">
                    Selected
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted">{opt.description}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-md border border-border-subtle bg-surface-tint px-3 py-2 text-xs text-muted-strong">
        Currently displaying:{" "}
        <span className="font-medium text-text">{effectiveTheme}</span>
        {preference === "system" && (
          <> — following your operating system preference</>
        )}
      </div>
    </div>
  );
}

function ThemePreview({ preview }: { preview: ThemeOption["preview"] }) {
  return (
    <div
      className="h-20 w-full rounded-md border overflow-hidden relative"
      style={{ background: preview.bg, borderColor: preview.border }}
      aria-hidden
    >
      {/* Faux sidebar */}
      <div
        className="absolute left-0 top-0 h-full w-1/4"
        style={{ background: preview.surface, borderRight: `1px solid ${preview.border}` }}
      />
      {/* Faux header line */}
      <div
        className="absolute left-[28%] top-2 h-1.5 w-2/5 rounded-sm"
        style={{ background: preview.text, opacity: 0.7 }}
      />
      {/* Faux body lines */}
      <div
        className="absolute left-[28%] top-6 h-1 w-1/2 rounded-sm"
        style={{ background: preview.text, opacity: 0.3 }}
      />
      <div
        className="absolute left-[28%] top-9 h-1 w-2/5 rounded-sm"
        style={{ background: preview.text, opacity: 0.3 }}
      />
      {/* Accent pill */}
      <div
        className="absolute right-2 bottom-2 h-2 w-8 rounded-full"
        style={{ background: preview.accent }}
      />
    </div>
  );
}
