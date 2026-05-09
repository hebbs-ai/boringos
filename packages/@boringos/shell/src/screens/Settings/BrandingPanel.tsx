// SPDX-License-Identifier: BUSL-1.1
//
// Settings → Branding panel.
// Admin-only edit of every Brand field plus a reset-to-defaults button.

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "../../auth/AuthProvider.js";
import { useBrand } from "../../branding/BrandProvider.js";
import { BORINGOS_BRAND } from "../../branding/defaults.js";
import type { Brand } from "../../branding/types.js";
import { Button } from "../../components/ui/button.js";

const FIELD_LABELS: Record<keyof Brand, string> = {
  productName: "Product name",
  productTagline: "Tagline",
  logoUrl: "Logo URL",
  faviconUrl: "Favicon URL",
  primaryColor: "Primary color",
  secondaryColor: "Secondary color",
  loginBackground: "Login background URL",
  emailFromName: "Email sender name",
};

const COLOR_FIELDS: (keyof Brand)[] = ["primaryColor", "secondaryColor"];

export function BrandingPanel() {
  const { user } = useAuth();
  const { brand, isLoading, setBrand, reset } = useBrand();
  const [draft, setDraft] = useState<Brand>(brand);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setDraft(brand);
  }, [brand]);

  const isAdmin = user?.role === "admin";

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await setBrand(draft);
      setSavedAt(Date.now());
      toast.success("Branding saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setSaving(true);
    try {
      await reset();
      setSavedAt(Date.now());
      toast.success("Branding reset to defaults");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-xl">
        <p className="text-sm text-muted">
          Branding is admin-only. Ask a tenant admin to customize this.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted mb-6">
        Override BoringOS branding for this tenant. Empty fields fall back to
        the BoringOS default. Saves take effect immediately across the shell.
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {(Object.keys(FIELD_LABELS) as (keyof Brand)[]).map((key) => (
          <div key={key}>
            <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1">
              {FIELD_LABELS[key]}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                placeholder={BORINGOS_BRAND[key] || "—"}
                className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint"
              />
              {COLOR_FIELDS.includes(key) && (
                <input
                  type="color"
                  value={draft[key] || BORINGOS_BRAND[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  aria-label={`${FIELD_LABELS[key]} color picker`}
                  className="h-9 w-9 cursor-pointer rounded border border-border"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Live preview — shows how the chrome looks with the draft palette
          before saving. */}
      <BrandPreview draft={draft} />

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={handleReset} disabled={saving || isLoading}>
          Reset to defaults
        </Button>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-muted">
              Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
          <Button onClick={handleSave} disabled={saving || isLoading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BrandPreview({ draft }: { draft: Brand }) {
  return (
    <section className="mt-8">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Preview</div>
      <div
        className="rounded-xl border border-border p-5"
        style={{
          // Use draft tokens locally so the preview reflects unsaved
          // changes without rewriting :root.
          ["--color-accent" as string]: draft.primaryColor,
          ["--color-navy" as string]: draft.secondaryColor,
          background: "var(--color-bg-warm)",
        }}
      >
        <div className="flex items-center gap-3">
          {draft.logoUrl ? (
            <img src={draft.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
          ) : (
            <span className="text-2xl" style={{ color: draft.primaryColor }} aria-hidden>◉</span>
          )}
          <span className="font-logo text-base font-bold tracking-[0.06em] text-text">
            {draft.productName || BORINGOS_BRAND.productName}
          </span>
        </div>
        {draft.productTagline && (
          <p className="mt-2 text-xs text-muted">{draft.productTagline}</p>
        )}
        <div className="mt-4 flex items-center gap-2">
          <Button>Primary CTA</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-accent-tint px-2.5 py-0.5 text-[11px] text-accent">
          status pill
        </div>
      </div>
    </section>
  );
}
