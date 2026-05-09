// SPDX-License-Identifier: BUSL-1.1
//
// Create-agent modal triggered by the "+ New" button on the Agents
// header. Two paths:
//
//   1. From persona — POST /agents/from-template with a role; the
//      framework loads the persona bundle and fills instructions.
//   2. Blank — POST /agents with name + role + runtime + reportsTo.
//
// On success the panel auto-opens for the new agent so the operator
// can immediately customise instructions / icon / routing tags.

import { useEffect, useState } from "react";
import { useAgents, useClient } from "@boringos/ui";
import type { Agent } from "@boringos/ui";

import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";

const BUILT_IN_PERSONAS = [
  "ceo",
  "cto",
  "chief-of-staff",
  "engineer",
  "researcher",
  "pm",
  "qa",
  "devops",
  "designer",
  "personal-assistant",
  "content-creator",
  "finance",
  "copilot",
] as const;

type Mode = "persona" | "blank";

export function NewAgentModal({
  agents,
  onClose,
  onCreated,
}: {
  agents: Agent[];
  onClose: () => void;
  onCreated: (agentId: string) => void;
}) {
  const client = useClient();
  const { createAgent } = useAgents();

  const [mode, setMode] = useState<Mode>("persona");
  const [persona, setPersona] = useState<string>(BUILT_IN_PERSONAS[3]); // engineer default
  const [name, setName] = useState<string>("");
  const [role, setRole] = useState<string>("general");
  const [reportsTo, setReportsTo] = useState<string>("");
  const [runtimes, setRuntimes] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [runtimeId, setRuntimeId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = (await client.getRuntimes()) as Array<{ id: string; name: string; type: string }>;
        setRuntimes(list);
      } catch {
        // non-fatal — modal still works without runtime selection
      }
    })();
  }, [client]);

  // Default reportsTo to the tenant root agent (Chief of Staff).
  // We pick the first agent without a manager — that's the rooted one.
  useEffect(() => {
    if (reportsTo) return;
    const root = agents.find((a) => !a.reportsTo);
    if (root) setReportsTo(root.id);
  }, [agents, reportsTo]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      let created: Agent;
      if (mode === "persona") {
        // POST /agents/from-template doesn't go through the typed
        // client; use raw fetch with the same auth pattern.
        const cfg = (client as { config?: { url?: string; token?: string; tenantId?: string } }).config ?? {};
        const res = await fetch(`${cfg.url ?? ""}/api/admin/agents/from-template`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
            ...(cfg.tenantId ? { "X-Tenant-Id": cfg.tenantId } : {}),
          },
          body: JSON.stringify({
            role: persona,
            name: name.trim() || undefined,
            runtimeId: runtimeId || undefined,
            reportsTo: reportsTo || undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `from-template ${res.status}`);
        }
        created = (await res.json()) as Agent;
      } else {
        if (!name.trim()) {
          setError("Name required");
          setBusy(false);
          return;
        }
        created = await createAgent({
          name: name.trim(),
          role: role.trim() || "general",
          runtimeId: runtimeId || undefined,
        });
      }
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an agent</DialogTitle>
          <DialogDescription>
            Add a member to your cabinet. Start from a built-in persona or build one from scratch.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 inline-flex rounded-md border border-border">
          <ModeButton current={mode} value="persona" label="From persona" onClick={() => setMode("persona")} />
          <ModeButton current={mode} value="blank" label="Blank" onClick={() => setMode("blank")} />
        </div>

        <div className="mt-4 space-y-4">
          {mode === "persona" ? (
            <Field label="Persona">
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
              >
                {BUILT_IN_PERSONAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Role">
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="general"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
              />
            </Field>
          )}

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "persona" ? "(defaults to persona name)" : "e.g. Maya"}
              autoFocus
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
            />
          </Field>

          <Field label="Runtime">
            <select
              value={runtimeId}
              onChange={(e) => setRuntimeId(e.target.value)}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
            >
              <option value="">— Tenant default —</option>
              {runtimes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.type})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Reports to">
            <select
              value={reportsTo}
              onChange={(e) => setReportsTo(e.target.value)}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
            >
              <option value="">— Top of cabinet —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.role}
                </option>
              ))}
            </select>
          </Field>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Creating…" : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  current,
  value,
  label,
  onClick,
}: {
  current: Mode;
  value: Mode;
  label: string;
  onClick: () => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md ${
        active ? "bg-accent text-white" : "bg-white text-text-secondary hover:bg-bg"
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-muted">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
