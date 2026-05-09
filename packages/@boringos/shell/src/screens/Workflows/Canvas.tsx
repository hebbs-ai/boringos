// SPDX-License-Identifier: BUSL-1.1
//
// React Flow 12 canvas for v2 workflows. Sleek nodes, elkjs auto-layout,
// drag/connect/delete, condition nodes with two output handles, status
// overlay in run mode. The "+ insert mid-edge" affordance is rendered
// by hovering an edge — clicking it opens the palette pre-filtered.

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BlockRun, V2Block, V2Edge } from "./types.js";
import { autoLayout } from "./layout.js";
import { BlockNode, type BlockNodeData, nodeTypes as baseNodeTypes } from "./CanvasNodes.js";
import { blockKind, edgeId, newBlockId } from "./utils.js";

// ── Edge with hover-revealed `+` insert affordance ─────────────────────────

function InsertEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, sourceHandleId } =
    props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 6,
  });
  const stroke =
    sourceHandleId === "true"
      ? "rgb(16 185 129)"
      : sourceHandleId === "false"
        ? "rgb(244 63 94)"
        : "rgb(148 163 184)";

  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        markerEnd={markerEnd}
        style={style}
        className="transition-[stroke-width] hover:[stroke-width:2]"
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          data-edge-insert={id}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="opacity-0 hover:opacity-100 group-hover:opacity-100 w-4 h-4 rounded-full bg-white border border-border text-[10px] leading-none text-muted-strong shadow-sm transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            const ev = new CustomEvent("workflow:insert-on-edge", { detail: { edgeId: id } });
            window.dispatchEvent(ev);
          }}
        >
          +
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { insert: InsertEdge } as const;
const nodeTypes = baseNodeTypes;

// ── Public Canvas component ────────────────────────────────────────────────

export interface CanvasProps {
  blocks: V2Block[];
  edges: V2Edge[];
  selectedId: string | null;
  pinnedIds: Set<string>;
  blockRuns?: BlockRun[];
  mode: "edit" | "view";
  onSelect: (id: string | null) => void;
  onChange: (blocks: V2Block[], edges: V2Edge[]) => void;
  onOpenPalette: (atEdgeId?: string) => void;
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  blocks,
  edges,
  selectedId,
  pinnedIds,
  blockRuns,
  mode,
  onSelect,
  onChange,
  onOpenPalette,
}: CanvasProps) {
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rfNodes, setRfNodes] = useState<Node<BlockNodeData>[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const layoutCacheRef = useRef<Record<string, { x: number; y: number }>>({});

  // Compute (or restore) node positions whenever blocks/edges change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Layout only blocks without persisted positions.
      const needsLayout = blocks.some((b) => !b.position && !layoutCacheRef.current[b.id]);
      let positions = { ...layoutCacheRef.current };
      for (const b of blocks) if (b.position) positions[b.id] = b.position;
      if (needsLayout) {
        try {
          const out = await autoLayout(blocks, edges);
          if (cancelled) return;
          positions = { ...positions, ...out.positions };
          layoutCacheRef.current = positions;
        } catch {
          /* fall through with whatever we have */
        }
      }
      const runByBlock = new Map<string, BlockRun>();
      for (const r of blockRuns ?? []) runByBlock.set(r.blockId, r);

      const nodes: Node<BlockNodeData>[] = blocks.map((b) => {
        const pos = positions[b.id] ?? { x: 0, y: 0 };
        const run = runByBlock.get(b.id);
        return {
          id: b.id,
          type: "block",
          position: pos,
          data: {
            block: b,
            selected: b.id === selectedId,
            status: run?.status ?? null,
            durationMs: run?.durationMs ?? null,
            pinned: pinnedIds.has(b.id),
          },
          deletable: mode === "edit",
          draggable: mode === "edit",
        };
      });

      const rfeArr: Edge[] = edges.map((e, i) => ({
        id: edgeId(e) || `e_${i}`,
        source: e.sourceBlockId,
        target: e.targetBlockId,
        sourceHandle: e.sourceHandle,
        type: "insert",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "rgb(148 163 184)" },
      }));

      setRfNodes(nodes);
      setRfEdges(rfeArr);
    })();
    return () => {
      cancelled = true;
    };
  }, [blocks, edges, selectedId, pinnedIds, blockRuns, mode]);

  // Listen for the in-edge "+" click and proxy to parent.
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ edgeId: string }>;
      onOpenPalette(ce.detail.edgeId);
    };
    window.addEventListener("workflow:insert-on-edge", handler);
    return () => window.removeEventListener("workflow:insert-on-edge", handler);
  }, [onOpenPalette]);

  // Cmd-K binding inside the canvas.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
      }
    };
    const el = wrapRef.current;
    el?.addEventListener("keydown", handler);
    return () => el?.removeEventListener("keydown", handler);
  }, [onOpenPalette]);

  const projectChange = useCallback(
    (nextNodes: Node<BlockNodeData>[], nextEdges: Edge[]) => {
      // Persist positions so re-renders don't fight elk.
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of nextNodes) positions[n.id] = n.position;
      layoutCacheRef.current = { ...layoutCacheRef.current, ...positions };

      const newBlocks: V2Block[] = nextNodes.map((n) => {
        const orig = blocks.find((b) => b.id === n.id);
        const base: V2Block = orig ?? { id: n.id, kind: "tool" };
        return { ...base, position: n.position };
      });
      const newEdges: V2Edge[] = nextEdges.map((e) => ({
        id: e.id,
        sourceBlockId: e.source,
        targetBlockId: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
      }));
      onChange(newBlocks, newEdges);
    },
    [blocks, onChange],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nds) => {
        const next = applyNodeChanges(changes, nds) as Node<BlockNodeData>[];
        // Only emit on structural / position-end changes.
        const structural = changes.some(
          (c) =>
            c.type === "remove" ||
            c.type === "add" ||
            (c.type === "position" && (c as { dragging?: boolean }).dragging === false),
        );
        if (structural) projectChange(next, rfEdges);
        return next;
      });
    },
    [rfEdges, projectChange],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        const structural = changes.some((c) => c.type === "remove" || c.type === "add");
        if (structural) projectChange(rfNodes, next);
        return next;
      });
    },
    [rfNodes, projectChange],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const newE: Edge = {
        id: `${conn.source}-${conn.target}-${conn.sourceHandle ?? ""}-${Date.now()}`,
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? undefined,
        type: "insert",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "rgb(148 163 184)" },
      };
      setRfEdges((eds) => {
        const next = [...eds, newE];
        projectChange(rfNodes, next);
        return next;
      });
    },
    [rfNodes, projectChange],
  );

  const onPaneClick = useCallback(() => onSelect(null), [onSelect]);
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, n: Node) => onSelect(n.id),
    [onSelect],
  );

  // Memoize derived viewport-fit padding
  const fitViewOptions = useMemo(() => ({ padding: 0.18, maxZoom: 1.2 }), []);

  return (
    <div ref={wrapRef} tabIndex={-1} className="flex-1 outline-none relative bg-[#fafafa]">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={setRfInstance}
        fitView
        fitViewOptions={fitViewOptions}
        nodesDraggable={mode === "edit"}
        nodesConnectable={mode === "edit"}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={mode === "edit" ? ["Backspace", "Delete"] : null}
        defaultEdgeOptions={{ type: "insert" }}
        minZoom={0.4}
        maxZoom={2}
        className="group"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgb(203 213 225)" />
        <Controls
          showInteractive={false}
          className="!bg-white !border !border-border !rounded !shadow-sm [&>button]:!border-border-subtle [&>button]:!w-6 [&>button]:!h-6"
        />
      </ReactFlow>

      {/* Empty-state overlay */}
      {blocks.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-md border border-dashed border-border bg-white/80 px-4 py-3 text-xs text-muted text-center pointer-events-auto">
            Empty workflow — press{" "}
            <kbd className="font-mono px-1 rounded bg-bg-warm">⌘K</kbd> to add a block.
          </div>
        </div>
      )}

      {/* "Auto-layout" floating button (edit mode) */}
      {mode === "edit" && blocks.length > 1 && (
        <button
          type="button"
          onClick={async () => {
            const { positions } = await autoLayout(blocks, edges);
            layoutCacheRef.current = positions;
            const next: V2Block[] = blocks.map((b) => ({
              ...b,
              position: positions[b.id] ?? b.position ?? { x: 0, y: 0 },
            }));
            onChange(next, edges);
            setTimeout(() => rfInstance?.fitView({ padding: 0.18 }), 50);
          }}
          className="absolute bottom-3 right-3 px-2 py-1 rounded border border-border bg-white text-[11px] text-muted-strong hover:text-text shadow-sm"
        >
          Auto-layout
        </button>
      )}
    </div>
  );
}

// Re-export so editor.tsx can register a fresh BlockNode if needed.
export { BlockNode };
