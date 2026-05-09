// SPDX-License-Identifier: BUSL-1.1
//
// Three sections, top-down:
//  1. Inherited from modules (read-only) — every skill auto-loaded
//     into this agent's prompt because its tenant has the module
//     installed. Honest about what the agent already knows.
//  2. Routing tags — the editable `agents.routingTags` jsonb. Used by
//     the delegation router as keyword hints; NOT the same as prompt
//     skills (see task_15 §1 for context on why these are split).
//  3. Tenant skill library — one-click import of curated company_skills
//     into the routing tags.

import { useMemo, useState } from "react";
import type { Agent, CompanySkill, V2ModuleInfo, V2InstallInfo } from "@boringos/ui";

export function SkillsTab({
  agent,
  tenantSkills,
  modules,
  installs,
  onAdd,
  onRemove,
  busy,
}: {
  agent: Agent & { routingTags?: string[] };
  tenantSkills: CompanySkill[];
  modules: V2ModuleInfo[];
  installs: V2InstallInfo[];
  onAdd: (tag: string) => Promise<void>;
  onRemove: (tag: string) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  const attached = (agent.routingTags ?? []) as string[];
  const attachedSet = new Set(attached.map((s) => s.toLowerCase()));

  const submit = async () => {
    const v = draft.trim();
    if (!v) return;
    if (attachedSet.has(v.toLowerCase())) {
      setDraft("");
      return;
    }
    await onAdd(v);
    setDraft("");
  };

  const importable = tenantSkills.filter(
    (s) => !attachedSet.has((s.key ?? s.name).toLowerCase()),
  );

  // Inherited skills: every module installed in this tenant contributes
  // its skills to every agent's prompt. We compute the flat list here.
  const inherited = useMemo(() => {
    const installedIds = new Set(installs.map((i) => i.moduleId));
    const out: Array<{ moduleId: string; moduleName: string; skillId: string }> = [];
    for (const m of modules) {
      if (!installedIds.has(m.id)) continue;
      for (const s of m.skills) {
        out.push({ moduleId: m.id, moduleName: m.name, skillId: s.id });
      }
    }
    return out;
  }, [modules, installs]);

  return (
    <div className="space-y-5">
      <section>
        <div className="text-[11px] uppercase tracking-wide text-muted">
          Inherited from modules
          {inherited.length > 0 && (
            <span className="ml-1 text-muted">({inherited.length})</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Auto-loaded into every wake because the tenant has these modules
          installed. Read-only here — manage from the Modules screen.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {inherited.length === 0 && (
            <span className="text-xs italic text-muted">
              No modules installed yet.
            </span>
          )}
          {inherited.map((s) => (
            <span
              key={`${s.moduleId}::${s.skillId}`}
              title={`from ${s.moduleName}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-muted-strong"
            >
              <span className="font-mono text-[10px] text-muted">
                {s.moduleId}
              </span>
              <span>·</span>
              <span>{s.skillId}</span>
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-wide text-muted">
          Routing tags
        </div>
        <p className="mt-1 text-xs text-muted">
          Per-agent hints used by the delegation router (e.g. "send tasks
          mentioning <code>sql</code> here"). Not the same as prompt skills above.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {attached.length === 0 && (
            <span className="text-xs italic text-muted">No skills attached yet.</span>
          )}
          {attached.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent-tint px-2.5 py-1 text-xs text-accent"
            >
              {skill}
              <button
                type="button"
                onClick={() => void onRemove(skill)}
                disabled={busy}
                className="text-accent hover:text-accent disabled:cursor-not-allowed"
                aria-label={`Remove ${skill}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Add a skill (e.g. inbox-triage, sql, copywriting)"
            className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-xs text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-tint"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || draft.trim().length === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </section>

      {tenantSkills.length > 0 && (
        <section>
          <div className="text-[11px] uppercase tracking-wide text-muted">
            Tenant skill library
          </div>
          <p className="mt-1 text-xs text-muted">
            Curated skills synced for this tenant. Click to attach.
          </p>
          <ul className="mt-3 divide-y divide-border-subtle rounded-lg border border-border">
            {importable.length === 0 && (
              <li className="px-3 py-3 text-xs italic text-muted">
                Every tenant skill is already attached.
              </li>
            )}
            {importable.map((skill) => (
              <li key={skill.id} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-text">{skill.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted">
                    {skill.description ?? skill.key}
                  </div>
                </div>
                <span className="rounded bg-bg-warm px-1.5 py-0.5 font-mono text-[10px] text-muted-strong">
                  {skill.trustLevel}
                </span>
                <button
                  type="button"
                  onClick={() => void onAdd(skill.key ?? skill.name)}
                  disabled={busy}
                  className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Attach
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
