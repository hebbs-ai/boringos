// SPDX-License-Identifier: BUSL-1.1
//
// Apps screen — the wp-admin Plugins page. Four tabs:
// Browse, Installed, Updates, Install from URL.
// The "killer screen" of v1, per the phase plan.

import { useMemo, useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { ScreenBody, ScreenHeader } from "../_shared.js";
import { Browse } from "./Browse.js";
import { Installed } from "./Installed.js";
import { Modules } from "./Modules.js";
import { Updates } from "./Updates.js";
import { InstallFromUrl } from "./InstallFromUrl.js";
import type { InstallApiOptions } from "./installApi.js";

const TABS = [
  { id: "browse", label: "Browse" },
  { id: "installed", label: "Installed" },
  { id: "modules", label: "Modules" },
  { id: "updates", label: "Updates" },
  { id: "install-from-url", label: "Install from URL" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Apps() {
  const [tab, setTab] = useState<TabId>("browse");
  const { token, user } = useAuth();

  const apiOptions = useMemo<InstallApiOptions>(() => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (user?.tenantId) headers["X-Tenant-Id"] = user.tenantId;
    return { headers };
  }, [token, user?.tenantId]);

  return (
    <>
      <ScreenHeader
        title="Apps"
        subtitle="Browse, install, and manage apps for your tenant"
      />
      <div className="px-8 border-b border-border-subtle">
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                tab === t.id
                  ? "border-accent text-text font-medium"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <ScreenBody>
        {tab === "browse" && <Browse api={apiOptions} />}
        {tab === "installed" && <Installed api={apiOptions} />}
        {tab === "modules" && <Modules />}
        {tab === "updates" && <Updates />}
        {tab === "install-from-url" && <InstallFromUrl api={apiOptions} />}
      </ScreenBody>
    </>
  );
}
