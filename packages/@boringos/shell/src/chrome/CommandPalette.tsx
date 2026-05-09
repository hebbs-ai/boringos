// SPDX-License-Identifier: BUSL-1.1
//
// Global ⌘K command palette. Built on `cmdk` (already a shell dep).
// Targets:
//   - Jump to: home/copilot/inbox/calendar/tasks/agents/workflows/drive/...
//   - Jump to specific agent / task by name (uses cached react-query data)
//   - Quick actions: + new agent, invite team member, open settings
//
// Bound to ⌘K (Mac) / Ctrl+K (Win/Linux). Closes on Escape, navigation,
// or backdrop click.

import { Command } from "cmdk";
import {
  Activity,
  AppWindow,
  Calendar as CalendarIcon,
  CheckSquare,
  Cog,
  DollarSign,
  Folders,
  Home,
  Inbox,
  MessageSquare,
  Plug,
  Repeat,
  Shapes,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Agent, Task } from "@boringos/ui";

import { useAuth } from "../auth/AuthProvider.js";

interface NavTarget {
  to: string;
  label: string;
  Icon: LucideIcon;
  group: string;
  adminOnly?: boolean;
}

const NAV_TARGETS: NavTarget[] = [
  { to: "/home", label: "Home", Icon: Home, group: "Work" },
  { to: "/copilot", label: "Copilot", Icon: MessageSquare, group: "Work" },
  { to: "/inbox", label: "Inbox", Icon: Inbox, group: "Work" },
  { to: "/calendar", label: "Calendar", Icon: CalendarIcon, group: "Work" },
  { to: "/tasks", label: "Tasks", Icon: CheckSquare, group: "Work" },
  { to: "/drive", label: "Drive", Icon: Folders, group: "Work" },
  { to: "/agents", label: "Agents", Icon: Users, group: "Cabinet" },
  { to: "/workflows", label: "Workflows", Icon: Workflow, group: "Cabinet" },
  { to: "/apps", label: "Apps", Icon: AppWindow, group: "Extend", adminOnly: true },
  { to: "/connectors", label: "Connectors", Icon: Plug, group: "Extend", adminOnly: true },
  { to: "/routines", label: "Routines", Icon: Repeat, group: "Extend", adminOnly: true },
  { to: "/budgets", label: "Budgets", Icon: DollarSign, group: "Extend", adminOnly: true },
  { to: "/team", label: "Team", Icon: Shapes, group: "Admin", adminOnly: true },
  { to: "/activity", label: "Activity", Icon: Activity, group: "Admin", adminOnly: true },
  { to: "/settings", label: "Settings", Icon: Cog, group: "Admin", adminOnly: true },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Bind ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Read cached agents + tasks (from react-query) for jump-to.
  const cachedAgents = (queryClient.getQueryData<Agent[]>(["agents"]) ?? []) as Agent[];
  const cachedTasks = (queryClient.getQueryData<Task[]>(["tasks", undefined]) ?? []) as Task[];

  const visibleNav = NAV_TARGETS.filter((t) => !t.adminOnly || isAdmin);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-navy/30 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <Command
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <Command.Input
          placeholder="Jump to anything…"
          autoFocus
          className="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted focus:outline-none"
        />
        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-xs text-muted">
            Nothing matches.
          </Command.Empty>

          {Array.from(new Set(visibleNav.map((t) => t.group))).map((group) => (
            <Command.Group key={group} heading={group} className="mb-1">
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-muted">
                {group}
              </div>
              {visibleNav
                .filter((t) => t.group === group)
                .map(({ to, label, Icon }) => (
                  <Command.Item
                    key={to}
                    onSelect={() => go(to)}
                    value={`${group} ${label}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary aria-selected:bg-bg-warm aria-selected:text-text"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-strong" />
                    <span>{label}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted">
                      {to}
                    </span>
                  </Command.Item>
                ))}
            </Command.Group>
          ))}

          {cachedAgents.length > 0 && (
            <Command.Group heading="Agents" className="mb-1">
              <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted">
                Agents
              </div>
              {cachedAgents.slice(0, 12).map((a) => (
                <Command.Item
                  key={a.id}
                  onSelect={() => go("/agents")}
                  value={`agent ${a.name} ${a.role}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary aria-selected:bg-bg-warm aria-selected:text-text"
                >
                  <Users className="h-4 w-4 shrink-0 text-muted-strong" />
                  <span>{a.name}</span>
                  <span className="ml-auto text-[11px] text-muted">{a.role}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {cachedTasks.length > 0 && (
            <Command.Group heading="Tasks" className="mb-1">
              <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted">
                Tasks
              </div>
              {cachedTasks.slice(0, 12).map((t) => (
                <Command.Item
                  key={t.id}
                  onSelect={() => go("/tasks")}
                  value={`task ${t.title}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary aria-selected:bg-bg-warm aria-selected:text-text"
                >
                  <CheckSquare className="h-4 w-4 shrink-0 text-muted-strong" />
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto text-[11px] text-muted">{t.status}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>

        <div className="flex items-center justify-between border-t border-border-subtle bg-bg px-3 py-2 text-[10px] text-muted">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span className="font-mono">⌘K</span>
        </div>
      </Command>
    </div>
  );
}
