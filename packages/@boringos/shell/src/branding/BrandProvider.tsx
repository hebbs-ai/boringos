// SPDX-License-Identifier: BUSL-1.1
//
// BrandProvider — loads the tenant's brand.* settings on auth, exposes
// the resolved Brand (with BoringOS defaults filled in) to chrome and
// apps via useBrand().
//
// Updates immediately when setBrand() is called from the Branding
// panel — no full page reload needed.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "../auth/AuthProvider.js";

import { BORINGOS_BRAND, resolveBrand } from "./defaults.js";
import type { Brand, PartialBrand } from "./types.js";

interface BrandContextValue {
  brand: Brand;
  isLoading: boolean;
  /** Save updates to tenant_settings (admin-only on the server side). */
  setBrand: (partial: PartialBrand) => Promise<void>;
  /** Revert all brand.* settings to the BoringOS defaults. */
  reset: () => Promise<void>;
}

const BrandContext = createContext<BrandContextValue | null>(null);

const SETTINGS_BASE = "/api/admin/settings";

const BRAND_KEYS: (keyof Brand)[] = [
  "productName",
  "productTagline",
  "logoUrl",
  "faviconUrl",
  "primaryColor",
  "secondaryColor",
  "loginBackground",
  "emailFromName",
];

function authHeaders(token: string | null, tenantId: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

/**
 * Reads tenant_settings via the framework's admin API and extracts the
 * brand.* keys. Settings the framework returns as `{ key, value }`
 * pairs are flattened into a PartialBrand.
 */
async function loadBrand(token: string, tenantId: string): Promise<PartialBrand> {
  try {
    const res = await fetch(SETTINGS_BASE, { headers: authHeaders(token, tenantId) });
    if (!res.ok) return {};
    const raw = (await res.json()) as unknown;
    const settings: Record<string, unknown> = {};

    if (Array.isArray(raw)) {
      for (const row of raw as Array<{ key?: string; value?: unknown }>) {
        if (typeof row.key === "string") settings[row.key] = row.value;
      }
    } else if (raw && typeof raw === "object") {
      Object.assign(settings, raw as Record<string, unknown>);
    }

    const partial: PartialBrand = {};
    for (const k of BRAND_KEYS) {
      const v = settings[`brand.${k}`];
      if (typeof v === "string") {
        // Loose runtime cast — Brand fields are all strings, validated
        // by `resolveBrand` which trims and falls back to defaults.
        (partial as Record<string, string>)[k] = v;
      }
    }
    return partial;
  } catch {
    return {};
  }
}

async function saveBrandSettings(
  token: string,
  tenantId: string,
  updates: PartialBrand,
): Promise<void> {
  // Single PATCH carrying every brand.* key the caller wants to update.
  // Empty string is treated as "clear" (server-side may delete the row;
  // resolveBrand will then fall back to the default).
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === "string") body[`brand.${k}`] = v;
  }
  const res = await fetch(SETTINGS_BASE, {
    method: "PATCH",
    headers: authHeaders(token, tenantId),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to save branding (${res.status}) ${text}`);
  }
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [partial, setPartial] = useState<PartialBrand>({});
  const [isLoading, setLoading] = useState(false);

  // Load on auth.
  useEffect(() => {
    if (!token || !user?.tenantId) {
      setPartial({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadBrand(token, user.tenantId)
      .then((p) => {
        if (!cancelled) setPartial(p);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user?.tenantId]);

  const brand = useMemo(() => resolveBrand(partial), [partial]);

  // Bridge: write resolved brand colors to CSS custom properties at
  // :root. Every shell screen that uses semantic tokens (bg-accent,
  // text-accent, etc.) repaints automatically. See task_18 §2b.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-accent", brand.primaryColor);
    // Derive a slightly lighter accent for hover/highlight states.
    root.style.setProperty("--color-accent-light", brand.primaryColor);
    root.style.setProperty("--color-navy", brand.secondaryColor);
    if (brand.faviconUrl) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) link.href = brand.faviconUrl;
    }
    document.title = brand.productName;
  }, [brand.primaryColor, brand.secondaryColor, brand.faviconUrl, brand.productName]);

  const setBrand = useCallback(
    async (updates: PartialBrand) => {
      if (!token || !user?.tenantId) return;
      await saveBrandSettings(token, user.tenantId, updates);
      // Optimistic local update so the chrome refreshes immediately
      // without a server round-trip.
      setPartial((prev) => ({ ...prev, ...updates }));
    },
    [token, user?.tenantId],
  );

  const reset = useCallback(async () => {
    const empties: PartialBrand = {};
    for (const k of BRAND_KEYS) (empties as Record<string, string>)[k] = "";
    await setBrand(empties);
  }, [setBrand]);

  const value: BrandContextValue = { brand, isLoading, setBrand, reset };

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) {
    // Allow useBrand() outside a BrandProvider — return defaults so apps
    // imported into a non-shell context (tests, scaffolders) still work.
    return {
      brand: BORINGOS_BRAND,
      isLoading: false,
      setBrand: async () => {
        // no-op outside provider
      },
      reset: async () => {
        // no-op outside provider
      },
    };
  }
  return ctx;
}
