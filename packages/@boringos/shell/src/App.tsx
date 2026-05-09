// SPDX-License-Identifier: BUSL-1.1
//
// Shell App — public auth routes (Login, Signup) + auth-gated chrome
// hosting the shell-mandatory screens. Admin-only routes are wrapped
// in <RequireAdmin> at this layer (task_16 phase 1).

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { Layout } from "./chrome/Layout.js";
import { SlotRegistryProvider } from "./slots/context.js";
import { AuthProvider, Login, RequireAdmin, RequireAuth, Signup } from "./auth/index.js";
import { BoringOSClientProvider } from "./providers/BoringOSClientProvider.js";
import { BrandProvider } from "./branding/BrandProvider.js";
import {
  Activity,
  Agents,
  Budgets,
  Calendar,
  Connectors,
  Copilot,
  Drive,
  Home,
  Inbox,
  Routines,
  Settings,
  Tasks,
  Team,
  Workflows,
} from "./screens/index.js";
import { Apps } from "./screens/Apps/index.js";

export function App() {
  return (
    <AuthProvider>
      <BoringOSClientProvider>
        <BrandProvider>
        <SlotRegistryProvider>
          <BrowserRouter>
            <Routes>
              {/* Public auth routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Auth-gated chrome */}
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route index element={<Navigate to="/home" replace />} />

                {/* Shell-mandatory screens (A5) */}
                <Route path="home" element={<Home />} />
                <Route path="copilot" element={<Copilot />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="agents" element={<Agents />} />
                <Route
                  path="workflows"
                  element={
                    <RequireAdmin title="Workflows">
                      <Workflows />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <RequireAdmin title="Settings">
                      <Settings />
                    </RequireAdmin>
                  }
                />

                {/* Approvals are tasks now — keep a redirect so old
                    bookmarks still land somewhere useful. */}
                <Route path="approvals" element={<Navigate to="/tasks?tab=my-todos" replace />} />
                <Route path="drive" element={<Drive />} />
                <Route
                  path="connectors"
                  element={
                    <RequireAdmin title="Connectors">
                      <Connectors />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="apps"
                  element={
                    <RequireAdmin title="Apps">
                      <Apps />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="routines"
                  element={
                    <RequireAdmin title="Routines">
                      <Routines />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="budgets"
                  element={
                    <RequireAdmin title="Budgets">
                      <Budgets />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="activity"
                  element={
                    <RequireAdmin title="Activity">
                      <Activity />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="team"
                  element={
                    <RequireAdmin title="Team">
                      <Team />
                    </RequireAdmin>
                  }
                />
              </Route>
            </Routes>
          </BrowserRouter>
        </SlotRegistryProvider>
        </BrandProvider>
      </BoringOSClientProvider>
    </AuthProvider>
  );
}
