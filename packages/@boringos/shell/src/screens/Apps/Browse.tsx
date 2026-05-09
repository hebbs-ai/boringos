// SPDX-License-Identifier: BUSL-1.1
//
// Browse tab — curated marketplace listings. v1 uses MOCK_LISTINGS;
// Phase 4 swaps this for a real fetch against the marketplace backend.

import { useMemo, useState } from "react";
import { validateManifest, type Manifest } from "@boringos/app-sdk";

import { installRuntime } from "../../runtime/install-runtime.js";
import { MOCK_LISTINGS } from "./mockListings.js";
import type { MarketplaceListing } from "./types.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import {
  createInstallApi,
  InstallApiResponseError,
  type InstallApiOptions,
} from "./installApi.js";

export interface BrowseProps {
  api?: InstallApiOptions;
  onInstalled?: (record: { appId: string; version: string }) => void;
}

export function Browse(props: BrowseProps = {}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  const categories = useMemo(
    () => ["All", ...new Set(MOCK_LISTINGS.map((l) => l.category))],
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MOCK_LISTINGS.filter((l) => {
      if (category !== "All" && l.category !== category) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          className="flex-1 max-w-sm rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">
          No apps match.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              api={props.api}
              onInstalled={props.onInstalled}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ListingCardProps {
  listing: MarketplaceListing;
  api?: InstallApiOptions;
  onInstalled?: (record: { appId: string; version: string }) => void;
}

function ListingCard({ listing, api, onInstalled }: ListingCardProps) {
  const installed = installRuntime.isInstalled(listing.id);
  const [pendingManifest, setPendingManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canInstall = !!listing.installUrl && !installed;

  const handleClick = async () => {
    if (!listing.installUrl) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(listing.installUrl);
      if (!res.ok) throw new Error(`Could not fetch boringos.json (HTTP ${res.status}).`);
      const raw = (await res.json()) as unknown;
      const valid = validateManifest(raw);
      if (!valid.valid) {
        const first = valid.errors[0];
        throw new Error(`Manifest is invalid: ${first?.path ?? "/"} ${first?.message ?? ""}`);
      }
      setPendingManifest(raw as Manifest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!listing.installUrl) return;
    setBusy(true);
    setError(null);
    try {
      const installApi = createInstallApi(api);
      const record = await installApi.install({ url: listing.installUrl });
      onInstalled?.({ appId: record.appId, version: record.version });
      setPendingManifest(null);
    } catch (e) {
      if (e instanceof InstallApiResponseError) {
        const detail = e.payload.detail ? `: ${e.payload.detail}` : "";
        setError(`${e.payload.error}${detail}`);
      } else {
        setError(e instanceof Error ? e.message : "Install failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border bg-white p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{listing.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {listing.publisher}
            {listing.verified && (
              <span className="ml-2 text-emerald-700 font-medium">verified</span>
            )}
            {listing.firstParty && (
              <span className="ml-2 text-accent font-medium">first-party</span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono text-muted shrink-0">
          {listing.category}
        </span>
      </div>

      <p className="text-xs text-muted-strong flex-1 mb-3">
        {listing.description}
      </p>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-[11px] text-red-700 mb-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted">{listing.license}</span>
        <button
          type="button"
          onClick={handleClick}
          disabled={!canInstall || busy}
          title={
            installed
              ? "Already installed"
              : listing.installUrl
                ? "Install"
                : "Marketplace integration lands in Phase 4"
          }
          className={`text-xs px-2.5 py-1 rounded-md ${
            installed
              ? "bg-emerald-50 text-emerald-700 cursor-default"
              : canInstall
                ? "bg-accent text-white hover:bg-accent-light disabled:opacity-50"
                : "bg-bg-warm text-muted cursor-not-allowed"
          }`}
        >
          {installed ? "Installed" : busy ? "Working…" : "Install"}
        </button>
      </div>

      {pendingManifest && (
        <div className="mt-3">
          <PermissionPrompt
            manifest={pendingManifest}
            source="github-direct"
            onApprove={handleApprove}
            onCancel={() => setPendingManifest(null)}
          />
        </div>
      )}
    </li>
  );
}
