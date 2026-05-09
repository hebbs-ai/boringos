// SPDX-License-Identifier: BUSL-1.1
//
// Install from URL tab — paste a GitHub URL, fetch its boringos.json,
// validate, show the permission prompt. The actual install transaction
// (DB row, agents, slots, onTenantCreated) lands in C5; this tab wires
// the *user-facing* portion that A7 owns: URL input → manifest fetch →
// validation → permission prompt → call into the install pipeline.

import { useState } from "react";
import { validateManifest, type Manifest } from "@boringos/app-sdk";

import { PermissionPrompt } from "./PermissionPrompt.js";
import {
  createInstallApi,
  InstallApiResponseError,
  type InstallApiOptions,
} from "./installApi.js";

const URL_PATTERN =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\/|$)/;

function parseGithubUrl(input: string): { org: string; repo: string } | null {
  const m = input.trim().match(URL_PATTERN);
  if (!m) return null;
  return { org: m[1]!, repo: m[2]!.replace(/\.git$/, "") };
}

/**
 * Best-effort manifest fetch. Tries the repo's main branch raw URL.
 * The real fetcher (TASK-C3) handles tagged releases, version pinning,
 * private repos, and signed bundles — A7 just needs enough to drive the
 * permission prompt UX.
 */
async function fetchManifest(input: string): Promise<Manifest> {
  const parsed = parseGithubUrl(input);
  if (!parsed) {
    throw new Error("Not a GitHub URL.");
  }
  const url = `https://raw.githubusercontent.com/${parsed.org}/${parsed.repo}/main/boringos.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not fetch boringos.json (HTTP ${res.status}).`);
  }
  const raw = (await res.json()) as unknown;
  const result = validateManifest(raw);
  if (!result.valid) {
    const first = result.errors[0];
    throw new Error(
      `Manifest is invalid: ${first?.path ?? "/"} ${first?.message ?? ""}`,
    );
  }
  return raw as Manifest;
}

export interface InstallFromUrlProps {
  /** Forwarded to createInstallApi; lets the host configure base URL + auth headers. */
  api?: InstallApiOptions;
  /** Called after a successful install (Apps screen refreshes the Installed tab). */
  onInstalled?: (record: { appId: string; version: string }) => void;
}

export function InstallFromUrl({ api, onInstalled }: InstallFromUrlProps = {}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFetch = async () => {
    setError(null);
    setManifest(null);
    setBusy(true);
    try {
      const m = await fetchManifest(url);
      setManifest(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    setError(null);
    setBusy(true);
    try {
      const installApi = createInstallApi(api);
      const record = await installApi.install({ url });
      onInstalled?.({ appId: record.appId, version: record.version });
      setManifest(null);
      setUrl("");
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
    <div className="max-w-xl">
      <p className="text-sm text-muted-strong mb-4">
        Paste a GitHub URL pointing at a repo with a <code>boringos.json</code> at
        its root. Public repos only in v1; private-repo support lands in C3.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/acme/my-stripe-connector"
          className="flex-1 rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
        <button
          type="button"
          onClick={handleFetch}
          disabled={busy || !url.trim()}
          className="px-3 py-2 text-sm rounded-md bg-accent text-white hover:bg-accent-light disabled:opacity-50"
        >
          {busy ? "Fetching…" : "Fetch"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {manifest && (
        <div className="mt-4">
          <PermissionPrompt
            manifest={manifest}
            source="github-direct"
            onApprove={handleApprove}
            onCancel={() => setManifest(null)}
          />
        </div>
      )}
    </div>
  );
}
