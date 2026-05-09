// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useState } from "react";
import type { Agent } from "@boringos/ui";

export function InstructionsTab({
  agent,
  onSave,
  saving,
}: {
  agent: Agent;
  onSave: (instructions: string) => Promise<void>;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(agent.instructions ?? "");

  useEffect(() => {
    setDraft(agent.instructions ?? "");
  }, [agent.id, agent.instructions]);

  const dirty = (agent.instructions ?? "") !== draft;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Agent‑specific instructions appended to the system prompt. Use this to teach
        this one agent something the rest of the cabinet shouldn’t see.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full resize-y rounded-lg border border-border bg-white px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-tint"
        placeholder="e.g. Always reply in British English. Skip tasks tagged 'noreply'."
      />
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted tabular-nums">{draft.length} chars</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(agent.instructions ?? "")}
            disabled={!dirty || saving}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => void onSave(draft)}
            disabled={!dirty || saving}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save instructions"}
          </button>
        </div>
      </div>
    </div>
  );
}
