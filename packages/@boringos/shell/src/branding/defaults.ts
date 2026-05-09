// SPDX-License-Identifier: BUSL-1.1
//
// Default BoringOS brand. Used when a tenant has not customized any
// brand.* setting in tenant_settings.

import type { Brand } from "./types.js";

export const BORINGOS_BRAND: Brand = {
  productName: "BoringOS",
  productTagline: "",
  logoUrl: "",
  faviconUrl: "",
  // Hebbs amber-700 — matches the marketing site's accent. Tenants
  // can override via brand.primaryColor in tenant_settings; the
  // BrandProvider's CSS-var bridge propagates the override into
  // --color-accent so every semantic-token consumer repaints.
  primaryColor: "#B45309",
  secondaryColor: "#1E293B", // navy/slate-800 — matches website's dark band
  loginBackground: "",
  emailFromName: "BoringOS",
};

/**
 * Map a partial brand from tenant_settings (with brand.* keys) to a
 * fully-resolved Brand by filling in any missing field with the
 * BoringOS default.
 */
export function resolveBrand(partial: Partial<Brand>): Brand {
  return {
    productName: partial.productName?.trim() || BORINGOS_BRAND.productName,
    productTagline: partial.productTagline?.trim() ?? BORINGOS_BRAND.productTagline,
    logoUrl: partial.logoUrl?.trim() ?? BORINGOS_BRAND.logoUrl,
    faviconUrl: partial.faviconUrl?.trim() ?? BORINGOS_BRAND.faviconUrl,
    primaryColor: partial.primaryColor?.trim() || BORINGOS_BRAND.primaryColor,
    secondaryColor: partial.secondaryColor?.trim() || BORINGOS_BRAND.secondaryColor,
    loginBackground: partial.loginBackground?.trim() ?? BORINGOS_BRAND.loginBackground,
    emailFromName: partial.emailFromName?.trim() || BORINGOS_BRAND.emailFromName,
  };
}
