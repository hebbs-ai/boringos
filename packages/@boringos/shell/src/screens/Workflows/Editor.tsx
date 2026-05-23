// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Workflow editor — canvas + inspector + palette + run drawer.
// Live runs stream in via SSE; pinning, run-from-here, and time-
// travel replay round out the UX.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ToolRow, AgentRow, EventTypeRow, Block, Edge, WorkflowSummary, BlockRun, BlockRunStatus } from "./types.js";
import { Canvas } from "./Canvas.js";
import { Inspector } from "./Inspector.js";
import { Palette } from "./Palette.js";
import { RunDrawer } from "./RunDrawer.js";
import { ForkModal } from "./ForkModal.js";
import { defaultBlock, edgeId, newBlockId } from "./utils.js";
import { buildFieldSources } from "./ValuePicker.js";
import {
  forkRun,
  getRun,
  listRuns,
  patchWorkflow,
  runWorkflow,
  type RunDetail,
} from "./api.js";
import { subscribeToRun } from "./sse.js";

type Tab = "canvas" | "source";

interface AuthLike {
  token: string | null;
  tenantId: string | undefined;
}

interface SaveState {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
}

export interface EditorProps {
  auth: AuthLike;
  workflow: WorkflowSummary;
  tools: ToolRow[];
  agents: AgentRow[];
  eventTypes: EventTypeRow[];
  onSaved: (wf: WorkflowSummary) => void;
}

export function Editor({ auth, workflow, tools, agents, eventTypes, onSaved }: EditorProps) {
  const [tab, setTab] = useState<Tab>("canvas");
  const [name, setName] = useState(workflow.name);
  const [status, setStatus] = useState(workflow.status ?? "draft");
  const [governingAgentId, setGoverningAgentId] = useState<string | null>(
    workflow.governingAgentId ?? null,
  );
  const [blocks, setBlocks] = useState<Block[]>(workflow.blocks ?? []);
  const [edges, setEdges] = useState<Edge[]>(workflow.edges ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteEdgeId, setPaletteEdgeId] = useState<string | undefined>();
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [recentRuns, setRecentRuns] = useState<RunDetail["run"][]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [forkBlockRun, setForkBlockRun] = useState<BlockRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the workflow id changes.
  useEffect(() => {
    setName(workflow.name);
    setStatus(workflow.status ?? "draft");
    setGoverningAgentId(workflow.governingAgentId ?? null);
    setBlocks(workflow.blocks ?? []);
    setEdges(workflow.edges ?? []);
    setSelectedId(null);
    setActiveRun(null);
    setRecentRuns([]);
  }, [workflow.id]);

  // Refresh runs whenever workflow id changes.
  useEffect(() => {
    listRuns(auth, workflow.id, 25).then(setRecentRuns).catch(() => setRecentRuns([]));
  }, [auth, workflow.id]);

  // Autosave (debounced) + an explicit flush for the Save button.
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSave = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirtyRef.current = false;
    setSaveState({ status: "saving" });
    try {
      const saved = await patchWorkflow(auth, workflow.id, {
        name,
        blocks,
        edges,
        status,
        governingAgentId,
      });
      setSaveState({ status: "saved" });
      onSaved(saved);
    } catch (e) {
      setSaveState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [auth, workflow.id, name, blocks, edges, status, governingAgentId, onSaved]);
  const queueSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (dirtyRef.current) void doSave();
    }, 700);
  }, [doSave]);

  // Trigger autosave when local state changes.
  useEffect(() => {
    queueSave();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, blocks, edges, status, governingAgentId]);

  // Live updates via SSE for the active run.
  useEffect(() => {
    if (!activeRun?.run.id) return;
    if (activeRun.run.status !== "running" && activeRun.run.status !== "queued") return;
    const unsubscribe = subscribeToRun(activeRun.run.id, auth.token, auth.tenantId, (e) => {
      // Patch activeRun.blocks based on event.
      const data = e.data as Record<string, unknown> & { blockId?: string; blockType?: string };
      setActiveRun((cur) => {
        if (!cur || cur.run.id !== (data.runId as string)) return cur;
        const next = { ...cur };
        if (e.type === "workflow:run_completed" || e.type === "workflow:run_failed") {
          next.run = {
            ...cur.run,
            status: e.type === "workflow:run_completed" ? "completed" : "failed",
            durationMs: (data.durationMs as number) ?? cur.run.durationMs,
          };
          // Refresh once the run finalizes so we get final block payloads.
          getRun(auth, cur.run.id).then(setActiveRun).catch(() => {});
          return next;
        }
        if (data.blockId) {
          const idx = cur.blocks.findIndex((b) => b.blockId === data.blockId);
          const status = mapEventToStatus(e.type);
          const partial: BlockRun = {
            blockId: data.blockId,
            status,
            durationMs: (data.durationMs as number) ?? null,
            error: typeof data.error === "string" ? (data.error as string) : null,
          };
          if (idx === -1) next.blocks = [...cur.blocks, partial];
          else next.blocks = cur.blocks.map((b, i) => (i === idx ? { ...b, ...partial } : b));
        }
        return next;
      });
    });
    return unsubscribe;
  }, [activeRun?.run.id, activeRun?.run.status, auth]);

  const selected = useMemo(() => blocks.find((b) => b.id === selectedId) ?? null, [blocks, selectedId]);
  // Upstream values the selected block can reference, with last-run
  // samples — powers the inspector's ValuePicker menus.
  const fieldSources = useMemo(
    () => buildFieldSources(blocks, edges, selectedId, activeRun?.blocks),
    [blocks, edges, selectedId, activeRun],
  );
  // type → human label, for trigger node labels + the inspector header.
  const eventLabels = useMemo(
    () => Object.fromEntries(eventTypes.map((e) => [e.type, e.description])),
    [eventTypes],
  );
  const blockRunForSelected = useMemo(() => {
    if (!selectedId || !activeRun) return null;
    return activeRun.blocks.find((b) => b.blockId === selectedId) ?? null;
  }, [activeRun, selectedId]);

  const handleCanvasChange = useCallback((nextBlocks: Block[], nextEdges: Edge[]) => {
    setBlocks(nextBlocks);
    setEdges(nextEdges);
  }, []);

  const handleBlockChange = useCallback(
    (patch: Partial<Block>) => {
      if (!selectedId) return;
      setBlocks((bs) => bs.map((b) => (b.id === selectedId ? { ...b, ...patch } : b)));
    },
    [selectedId],
  );

  const handleBlockDelete = useCallback(() => {
    if (!selectedId) return;
    setBlocks((bs) => bs.filter((b) => b.id !== selectedId));
    setEdges((es) => es.filter((e) => e.sourceBlockId !== selectedId && e.targetBlockId !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  // Toggle pinning on the selected block; uses last-run output as the cache.
  const handleTogglePin = useCallback(() => {
    if (!selectedId) return;
    const cur = blocks.find((b) => b.id === selectedId);
    if (!cur) return;
    const cfg = (cur.config ?? {}) as Record<string, unknown>;
    const isPinned = cfg.pinned === true;
    if (isPinned) {
      const { pinned: _p, pinnedOutput: _o, ...rest } = cfg;
      void _p; void _o;
      setBlocks((bs) => bs.map((b) => (b.id === selectedId ? { ...b, config: rest } : b)));
      return;
    }
    // Pin: capture last run output if available.
    const blockRun = activeRun?.blocks.find((b) => b.blockId === selectedId);
    const cachedOutput = blockRun?.output ?? cfg.pinnedOutput ?? {};
    setBlocks((bs) =>
      bs.map((b) =>
        b.id === selectedId
          ? { ...b, config: { ...cfg, pinned: true, pinnedOutput: cachedOutput } }
          : b,
      ),
    );
  }, [selectedId, blocks, activeRun]);

  const insertBlock = useCallback(
    (blk: Block) => {
      const eId = paletteEdgeId;
      if (eId) {
        const orig = edges.find((e) => edgeId(e) === eId || e.id === eId);
        if (orig) {
          const remaining = edges.filter((e) => e !== orig);
          const newEdges: Edge[] = [
            ...remaining,
            {
              id: `${orig.sourceBlockId}-${blk.id}-${orig.sourceHandle ?? ""}`,
              sourceBlockId: orig.sourceBlockId,
              targetBlockId: blk.id,
              sourceHandle: orig.sourceHandle,
            },
            {
              id: `${blk.id}-${orig.targetBlockId}`,
              sourceBlockId: blk.id,
              targetBlockId: orig.targetBlockId,
            },
          ];
          setBlocks((bs) => [...bs, blk]);
          setEdges(newEdges);
          setSelectedId(blk.id);
          setPaletteEdgeId(undefined);
          return;
        }
      }
      setBlocks((bs) => [...bs, blk]);
      if (selectedId) {
        setEdges((es) => [
          ...es,
          { id: `${selectedId}-${blk.id}`, sourceBlockId: selectedId, targetBlockId: blk.id },
        ]);
      }
      setSelectedId(blk.id);
    },
    [edges, paletteEdgeId, selectedId],
  );

  const handlePickKind = useCallback(
    (kind: string) => {
      const id = newBlockId(kind as Parameters<typeof newBlockId>[0], blocks);
      const blk = defaultBlock(kind as Parameters<typeof defaultBlock>[0], id);
      insertBlock(blk);
    },
    [blocks, insertBlock],
  );
  const handlePickTool = useCallback(
    (tool: ToolRow) => {
      const id = newBlockId("tool", blocks);
      const blk = defaultBlock("tool", id, tool.fullName);
      insertBlock(blk);
    },
    [blocks, insertBlock],
  );

  const onRun = useCallback(async () => {
    setError(null);
    try {
      const r = await runWorkflow(auth, workflow.id);
      if (r.runId) {
        const detail = await getRun(auth, r.runId);
        setActiveRun(detail);
        setDrawerOpen(true);
      }
      // Refresh list.
      listRuns(auth, workflow.id, 25).then(setRecentRuns).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [auth, workflow.id]);

  // Cmd-K from anywhere in the editor.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteEdgeId(undefined);
        setPaletteOpen(true);
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen]);

  const onSelectActiveRun = useCallback(
    async (runId: string) => {
      try {
        const detail = await getRun(auth, runId);
        setActiveRun(detail);
      } catch {
        // ignore
      }
    },
    [auth],
  );

  // Replay-from-here on the selected block.
  const onReplayFromHere = useCallback(() => {
    if (!selectedId || !blockRunForSelected || !activeRun) return;
    setForkBlockRun(blockRunForSelected);
    setForkOpen(true);
  }, [selectedId, blockRunForSelected, activeRun]);

  const confirmFork = useCallback(
    async (editedInputs: Record<string, unknown>) => {
      if (!activeRun || !forkBlockRun) return;
      try {
        const result = await forkRun(auth, activeRun.run.id, forkBlockRun.blockId, editedInputs);
        const detail = await getRun(auth, result.runId);
        setActiveRun(detail);
        setDrawerOpen(true);
        listRuns(auth, workflow.id, 25).then(setRecentRuns).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [auth, activeRun, forkBlockRun, workflow.id],
  );

  const onReplayActiveRun = useCallback(async () => {
    if (!activeRun) return;
    try {
      const r = await fetch(`/api/admin/workflow-runs/${activeRun.run.id}/replay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
          ...(auth.tenantId ? { "X-Tenant-Id": auth.tenantId } : {}),
        },
      });
      const body = (await r.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!r.ok) throw new Error(body.error ?? `replay: ${r.status}`);
      if (body.runId) {
        const detail = await getRun(auth, body.runId);
        setActiveRun(detail);
        listRuns(auth, workflow.id, 25).then(setRecentRuns).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [auth, activeRun, workflow.id]);

  const pinnedIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of blocks) {
      const cfg = (b.config ?? {}) as { pinned?: boolean };
      if (cfg.pinned === true) s.add(b.id);
    }
    return s;
  }, [blocks]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-2 border-b border-border-subtle bg-white">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-[15px] font-semibold text-text bg-transparent border-0 focus:outline-none focus:ring-0 w-72 truncate"
        />
        <SaveBadge state={saveState} />
        <StatusToggle status={status} onChange={setStatus} />
        {agents.length > 0 && (
          <select
            value={governingAgentId ?? ""}
            onChange={(e) => setGoverningAgentId(e.target.value || null)}
            title="Governing agent — the agent this workflow belongs to"
            className="text-[11px] text-muted-strong bg-bg-warm border border-border rounded px-1.5 py-1 max-w-[150px]"
          >
            <option value="">No governing agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto" />
        <Tabs current={tab} onChange={setTab} />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="text-[11px] text-muted hover:text-text px-2 py-1 rounded border border-border hover:border-border flex items-center gap-1"
          title="Cmd-K"
        >
          <span>+ Block</span>
          <kbd className="font-mono text-[9px] text-muted">⌘K</kbd>
        </button>
        <button
          type="button"
          onClick={() => void doSave()}
          disabled={saveState.status === "saving"}
          className="text-[11px] font-medium text-text bg-bg-warm hover:bg-border/40 px-2.5 py-1 rounded border border-border disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onRun}
          className="text-[11px] font-medium text-white bg-accent hover:bg-accent-light px-2.5 py-1 rounded"
        >
          ▶ Run
        </button>
      </header>

      {error && (
        <div className="px-5 py-1.5 bg-rose-50 border-b border-rose-200 text-[11px] text-rose-700 flex items-center gap-2">
          <span>{error}</span>
          <button className="ml-auto underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {/* Body */}
      {tab === "canvas" && (
        <div className="flex-1 flex min-h-0">
          <Canvas
            blocks={blocks}
            edges={edges}
            selectedId={selectedId}
            pinnedIds={pinnedIds}
            blockRuns={activeRun?.blocks}
            eventLabels={eventLabels}
            mode="edit"
            onSelect={setSelectedId}
            onChange={handleCanvasChange}
            onOpenPalette={(eid) => {
              setPaletteEdgeId(eid);
              setPaletteOpen(true);
            }}
          />
          <Inspector
            block={selected}
            tools={tools}
            sources={fieldSources}
            eventTypes={eventTypes}
            eventLabels={eventLabels}
            onChange={handleBlockChange}
            onDelete={handleBlockDelete}
            blockRun={blockRunForSelected}
            onTogglePin={handleTogglePin}
            onReplayFromHere={onReplayFromHere}
            canReplay={!!blockRunForSelected && !!activeRun}
          />
        </div>
      )}

      {tab === "source" && (
        <SourceTab
          blocks={blocks}
          edges={edges}
          onChange={(b, e) => {
            setBlocks(b);
            setEdges(e);
          }}
        />
      )}

      <RunDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen((o) => !o)}
        recentRuns={recentRuns}
        activeRun={activeRun}
        onPickRun={onSelectActiveRun}
        onPickBlock={(bid) => setSelectedId(bid)}
        blocks={blocks}
        selectedBlockId={selectedId}
        onReplayRun={onReplayActiveRun}
      />

      <Palette
        open={paletteOpen}
        onOpenChange={(o) => {
          setPaletteOpen(o);
          if (!o) setPaletteEdgeId(undefined);
        }}
        tools={tools}
        onPickKind={handlePickKind}
        onPickTool={handlePickTool}
      />

      <ForkModal
        open={forkOpen}
        blockRun={forkBlockRun}
        onClose={() => setForkOpen(false)}
        onConfirm={confirmFork}
      />
    </div>
  );
}

function StatusToggle({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  const active = status === "active";
  return (
    <button
      type="button"
      onClick={() => onChange(active ? "draft" : "active")}
      className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded border ${
        active
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : "bg-bg-warm border-border text-muted-strong"
      }`}
      title={
        active
          ? "Active — runs automatically when its trigger fires. Click to set to Draft."
          : "Draft — won't run automatically. Click to activate."
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-border"}`} />
      {active ? "Active" : "Draft"}
    </button>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map = {
    idle: { dot: "bg-emerald-500", text: "Saved", cls: "text-muted" },
    saved: { dot: "bg-emerald-500", text: "Saved", cls: "text-muted" },
    saving: { dot: "bg-amber-400 animate-pulse", text: "Saving…", cls: "text-muted" },
    error: { dot: "bg-rose-500", text: "Couldn't save — click Save to retry", cls: "text-rose-600" },
  } as const;
  const m = map[state.status];
  return (
    <span
      className={`flex items-center gap-1.5 text-[11px] ${m.cls}`}
      title={state.status === "error" ? state.message : "Changes save automatically"}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.text}
    </span>
  );
}

function mapEventToStatus(eventType: string): BlockRunStatus {
  switch (eventType) {
    case "workflow:block_started":
      return "running";
    case "workflow:block_completed":
      return "completed";
    case "workflow:block_failed":
      return "failed";
    case "workflow:block_skipped":
      return "skipped";
    case "workflow:block_waiting":
      return "waiting";
    default:
      return "pending";
  }
}

function Tabs({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  const TABS: { id: Tab; label: string }[] = [
    { id: "canvas", label: "Canvas" },
    { id: "source", label: "Source" },
  ];
  return (
    <div className="flex items-center text-[11px]">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`px-2.5 py-1 rounded transition-colors ${
            current === t.id ? "text-text font-medium bg-bg-warm" : "text-muted hover:text-text"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SourceTab({
  blocks,
  edges,
  onChange,
}: {
  blocks: Block[];
  edges: Edge[];
  onChange: (b: Block[], e: Edge[]) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify({ blocks, edges }, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(JSON.stringify({ blocks, edges }, null, 2));
  }, [blocks, edges]);
  return (
    <div className="flex-1 p-5 overflow-auto bg-white">
      {error && <div className="rounded bg-rose-50 border border-rose-200 px-2 py-1 text-[11px] text-rose-700 mb-2">{error}</div>}
      <textarea
        rows={28}
        className="w-full h-full rounded border border-border px-3 py-2 text-[12px] font-mono text-text focus:outline-none focus:border-accent"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value) as { blocks?: Block[]; edges?: Edge[] };
            if (!Array.isArray(parsed.blocks) || !Array.isArray(parsed.edges)) {
              setError("blocks and edges must be arrays");
              return;
            }
            setError(null);
            onChange(parsed.blocks, parsed.edges);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </div>
  );
}
