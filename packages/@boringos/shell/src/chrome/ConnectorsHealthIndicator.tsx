// SPDX-License-Identifier: BUSL-1.1
//
// N7 — Compact connector-health indicator. Floats top-right in the
// shell chrome. Hidden when every connector is healthy; surfaces a
// pill + count badge when something is degraded. Click expands a
// per-connector flyout with deep links to /connectors.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClient } from "@boringos/ui";

import {
  buildPageViewModel,
  type ConnectorStatusRow,
  type ConnectorViewModel,
} from "../screens/Connectors/connectorsPresenter.js";
import {
  fetchConnectorStatus,
  type ConnectorClientConfig,
} from "../screens/Connectors/connectorsApi.js";

const POLL_MS = 60_000;

function getConfig(client: unknown): ConnectorClientConfig | undefined {
  return (client as { config?: ConnectorClientConfig }).config;
}

export function ConnectorsHealthIndicator() {
  const client = useClient();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ConnectorStatusRow[] | null>(null);
  const [open, setOpen] = useState(false);

  const cfg = getConfig(client);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const fresh = await fetchConnectorStatus(cfg);
        if (!cancelled) setRows(fresh);
      } catch (err) {
        // Don't surface to UI — the indicator polls every 60s and the
        // dedicated /connectors page renders the same error in full.
        // But DO log so a "where's my indicator?" debug session doesn't
        // require reading the source.
        console.warn(
          "[ConnectorsHealthIndicator] /api/connectors/status poll failed:",
          err,
        );
      }
    }

    poll();
    timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [cfg?.url, cfg?.token, cfg?.tenantId]);

  const vm = buildPageViewModel(rows);
  const degraded: ConnectorViewModel[] = vm.cards.filter(
    (c) => c.status === "expired" || c.status === "error",
  );

  if (degraded.length === 0) return null;

  return (
    <div className="absolute top-3 right-4 z-40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-amber-50 ring-1 ring-amber-200 text-amber-800 text-[11px] font-medium px-2.5 py-1 hover:bg-amber-100"
        title={`${degraded.length} connector${degraded.length === 1 ? "" : "s"} need${degraded.length === 1 ? "s" : ""} attention`}
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-amber-500"
          aria-hidden
        />
        {degraded.length} connector{degraded.length === 1 ? "" : "s"} need
        {degraded.length === 1 ? "s" : ""} attention
      </button>

      {open && (
        <div
          className="mt-2 w-72 rounded-lg bg-white shadow-lg ring-1 ring-border overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <ul className="divide-y divide-border-subtle max-h-72 overflow-auto">
            {degraded.map((card) => (
              <li
                key={card.kind}
                className="px-3 py-2.5 flex items-start gap-2 hover:bg-bg cursor-pointer"
                onClick={() => {
                  setOpen(false);
                  navigate("/connectors");
                }}
              >
                <span
                  className={`mt-1.5 w-1.5 h-1.5 rounded-full ${
                    card.status === "expired"
                      ? "bg-amber-500"
                      : "bg-rose-500"
                  }`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-text truncate">
                    {card.name}
                  </div>
                  <div className="text-[11px] text-muted">
                    {card.statusLabel}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <button
            className="block w-full text-center text-xs font-medium text-muted-strong hover:bg-bg px-3 py-2 border-t border-border-subtle"
            onClick={() => {
              setOpen(false);
              navigate("/connectors");
            }}
          >
            Manage connectors →
          </button>
        </div>
      )}
    </div>
  );
}
