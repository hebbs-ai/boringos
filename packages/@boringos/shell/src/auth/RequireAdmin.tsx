// SPDX-License-Identifier: BUSL-1.1
//
// Route guard for admin-only screens. Wrapped at the route table in
// App.tsx so any direct navigation (sidebar click, URL bar, deep
// link) lands on the same friendly "Admin only" screen instead of
// the screen rendering and then 403'ing on the first API call.
//
// Pattern lifted from screens/Workflows/index.tsx:96-107 — promoting
// it from inline-per-screen to one wrapper at the routes layer.

import type { ReactNode } from "react";

import { useAuth } from "./AuthProvider.js";
import { EmptyState, ScreenBody, ScreenHeader } from "../screens/_shared.js";

export function RequireAdmin({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  const { user } = useAuth();
  if (user?.role !== "admin") {
    return (
      <>
        <ScreenHeader title={title ?? "Admin only"} />
        <ScreenBody>
          <EmptyState
            title="Admin access required"
            description="This screen is restricted to tenant admins. Ask your tenant admin to grant you the admin role."
          />
        </ScreenBody>
      </>
    );
  }
  return <>{children}</>;
}
