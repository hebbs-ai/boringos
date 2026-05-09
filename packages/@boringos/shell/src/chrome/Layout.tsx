// SPDX-License-Identifier: BUSL-1.1
//
// Shell layout — sidebar + main content area + command bar.
// CommandBar is rendered only on /home; every other screen has its
// own primary input (Copilot composer, Inbox reply, Task comments, …)
// and the bottom bar competes with them.

import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { Sidebar } from "./Sidebar.js";
import { CommandBar } from "./CommandBar.js";
import { CommandPalette } from "./CommandPalette.js";
import { ConnectorsHealthIndicator } from "./ConnectorsHealthIndicator.js";

export function Layout() {
  const { pathname } = useLocation();
  const showCommandBar = pathname === "/home" || pathname === "/";
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <ConnectorsHealthIndicator />
        <Outlet />
        {showCommandBar && <CommandBar />}
      </main>
      <CommandPalette />
      <Toaster
        position="bottom-right"
        theme="light"
        closeButton
        toastOptions={{
          style: {
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
          },
        }}
      />
    </div>
  );
}
