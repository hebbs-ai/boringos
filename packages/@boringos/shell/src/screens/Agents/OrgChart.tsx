// SPDX-License-Identifier: BUSL-1.1
//
// Recursive tree rendering of the cabinet hierarchy. Click a node to
// open the same right-rail detail panel the grid uses.

import type { OrgNode } from "@boringos/ui";
import { avatarColor, avatarMark, statusPill } from "./presenter.js";

export function OrgChart({
  tree,
  selectedId,
  onSelect,
}: {
  tree: OrgNode[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}) {
  if (tree.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
        No hierarchy yet.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {tree.map((node) => (
        <OrgBranch key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function OrgBranch({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: OrgNode;
  depth: number;
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}) {
  const pill = statusPill(node.status);
  const isSelected = node.id === selectedId;
  return (
    <li>
      <div className="flex items-start gap-3">
        {depth > 0 && (
          <div
            className="shrink-0 self-stretch border-l border-border"
            style={{ marginLeft: `${(depth - 1) * 24}px`, width: "24px" }}
            aria-hidden
          />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className={`flex flex-1 items-center gap-3 rounded-lg border bg-white px-3 py-2 text-left transition hover:border-border hover:shadow-sm ${
            isSelected ? "border-accent ring-2 ring-accent-tint" : "border-border"
          }`}
        >
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarColor(
              node.role,
            )}`}
          >
            {avatarMark({ role: node.role, name: node.name })}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text">{node.name}</div>
            <div className="truncate text-[11px] text-muted">{node.role}</div>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-medium ${pill.cls}`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${pill.dot}`} />
            {pill.label}
          </span>
        </button>
      </div>
      {node.reports.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.reports.map((child) => (
            <OrgBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
