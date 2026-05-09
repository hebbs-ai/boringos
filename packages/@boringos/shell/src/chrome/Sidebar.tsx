// SPDX-License-Identifier: BUSL-1.1
//
// Shell sidebar — fixed nav + app-contributed nav from the slot registry.
// Lifted from boringos-crm/packages/web/src/components/Sidebar.tsx.
//
// Differences vs the CRM original:
// - CRM-specific NAV_ITEMS removed. The shell ships a fixed set of
//   shell-mandatory entries (Home, Copilot, Inbox, Tasks, Drive, etc.).
// - App-contributed nav entries are read from the slot registry via
//   useSlot("pages") and rendered between the "Workspace" and "Tools"
//   groups.
// - Tenant menu + user card restored in A4 against the new
//   AuthProvider (was dropped in A3 because auth wasn't lifted yet).
// - Plain Tailwind classes (no custom design tokens). Branded styling
//   lands in A9 via the BrandProvider.

import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity as ActivityIcon,
  AppWindow,
  Calendar as CalendarIcon,
  CheckSquare,
  Cog,
  Database,
  DollarSign,
  Folders,
  GitBranch,
  Home as HomeIcon,
  Inbox as InboxIcon,
  MessageSquare,
  Plug,
  Repeat,
  Shapes,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "../auth/AuthProvider.js";
import { useBrand } from "../branding/BrandProvider.js";
import { useSlot } from "../slots/context.js";

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
}

// Sidebar groups are organised by audience, not data model:
//  - WORK: everyone — daily driver
//  - CABINET: read-for-everyone, edit-admin (gated per-action inside)
//  - EXTEND: admin only — install/configure capabilities
//  - ADMIN: admin only — tenant operations
// EXTEND + ADMIN are filtered at render time on user.role === "admin".

const WORK_ITEMS: NavItem[] = [
  { to: "/home", label: "Home", Icon: HomeIcon },
  { to: "/copilot", label: "Copilot", Icon: MessageSquare },
  { to: "/inbox", label: "Inbox", Icon: InboxIcon },
  { to: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { to: "/tasks", label: "Tasks", Icon: CheckSquare },
  { to: "/drive", label: "Drive", Icon: Folders },
];

const CABINET_ITEMS: NavItem[] = [
  { to: "/agents", label: "Agents", Icon: Users },
  { to: "/workflows", label: "Workflows", Icon: Workflow },
];

const EXTEND_ITEMS: NavItem[] = [
  { to: "/apps", label: "Apps", Icon: AppWindow },
  { to: "/connectors", label: "Connectors", Icon: Plug },
  { to: "/routines", label: "Routines", Icon: Repeat },
  { to: "/budgets", label: "Budgets", Icon: DollarSign },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: "/team", label: "Team", Icon: Shapes },
  { to: "/activity", label: "Activity", Icon: ActivityIcon },
  { to: "/settings", label: "Settings", Icon: Cog },
];

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
    isActive
      ? "bg-bg-warm text-text font-medium"
      : "text-muted-strong hover:bg-bg-warm hover:text-text"
  }`;

function NavGroup({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map(({ Icon, ...item }) => (
        <NavLink key={item.to} to={item.to} className={linkClasses}>
          <Icon className="h-4 w-4 shrink-0 text-muted-strong" aria-hidden />
          <span className="flex-1">{item.label}</span>
        </NavLink>
      ))}
    </>
  );
}

function GroupHeading({ children }: { children: string }) {
  return (
    <div className="mt-4 mb-1 px-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {children}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { user, logout, switchTenant } = useAuth();
  const { brand } = useBrand();
  const [showTenantMenu, setShowTenantMenu] = useState(false);

  const hasMultipleTenants = (user?.tenants?.length ?? 0) > 1;
  const isAdmin = user?.role === "admin";

  // App-contributed nav entries. Sorted by label.
  const appPages = useSlot("pages");
  const appNavItems: { appId: string; nav: NavItem }[] = appPages
    .map((c) => ({
      appId: c.appId,
      nav: {
        to: `/${c.appId}/${c.slotId}`,
        label: c.slot.id,
        Icon: GitBranch,
      },
    }))
    .sort((a, b) => a.nav.label.localeCompare(b.nav.label));

  return (
    <aside className="w-[248px] bg-bg border-r border-border p-2 flex flex-col shrink-0 overflow-y-auto">
      {/* Brand / tenant header — A9 BrandProvider personalizes the brand half */}
      <div className="px-2 pb-3 relative">
        <button
          type="button"
          onClick={() => hasMultipleTenants && setShowTenantMenu((v) => !v)}
          className={`flex items-center gap-2 w-full text-left rounded-md px-1 py-1 ${
            hasMultipleTenants ? "hover:bg-bg-warm cursor-pointer" : ""
          }`}
        >
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.productName}
              className="w-5 h-5 object-contain"
            />
          ) : (
            <span className="text-lg" style={{ color: brand.primaryColor }}>
              ◉
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h2
              className="font-logo text-sm font-bold text-text truncate"
              style={{ letterSpacing: "0.04em" }}
            >
              {user?.tenantName ?? brand.productName}
            </h2>
            {brand.productTagline && (
              <p className="text-[10px] text-muted truncate">
                {brand.productTagline}
              </p>
            )}
          </div>
          {hasMultipleTenants && (
            <span className="text-[10px] text-muted">▼</span>
          )}
        </button>

        {showTenantMenu && user?.tenants && (
          <div className="absolute left-2 right-2 top-full mt-1 rounded-md border border-border bg-white shadow-md z-50">
            {user.tenants.map((t) => (
              <button
                key={t.tenantId}
                type="button"
                onClick={() => {
                  void switchTenant(t.tenantId);
                  setShowTenantMenu(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-bg transition-colors ${
                  t.tenantId === user.tenantId
                    ? "font-medium text-accent"
                    : "text-text-secondary"
                }`}
              >
                {t.tenantName}
                <span className="ml-2 text-xs text-muted">{t.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="flex flex-col gap-0.5 flex-1">
        <GroupHeading>Work</GroupHeading>
        <NavGroup items={WORK_ITEMS} />

        {appNavItems.length > 0 && (
          <>
            <GroupHeading>Installed</GroupHeading>
            {appNavItems.map(({ appId, nav }) => {
              const { Icon } = nav;
              return (
                <NavLink key={`${appId}/${nav.to}`} to={nav.to} className={linkClasses}>
                  <Icon className="h-4 w-4 shrink-0 text-muted-strong" aria-hidden />
                  <span className="flex-1">{nav.label}</span>
                  <span className="text-[10px] text-muted font-mono">
                    {appId}
                  </span>
                </NavLink>
              );
            })}
          </>
        )}

        <GroupHeading>Cabinet</GroupHeading>
        <NavGroup items={CABINET_ITEMS} />

        {isAdmin && (
          <>
            <GroupHeading>Extend</GroupHeading>
            <NavGroup items={EXTEND_ITEMS} />

            <GroupHeading>Admin</GroupHeading>
            <NavGroup items={ADMIN_ITEMS} />
          </>
        )}
      </nav>

      {user && (
        <div className="mt-auto border-t border-border pt-3 px-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-accent-tint text-accent flex items-center justify-center text-xs font-semibold shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text truncate">
                {user.name}
              </div>
              <div className="text-xs text-muted truncate">{user.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-2 w-full text-left px-2 py-1 rounded text-xs text-muted hover:bg-bg-warm hover:text-text transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
