// SPDX-License-Identifier: BUSL-1.1
//
// Wraps protected routes — redirects to /login if no session.
// Used in App.tsx around the Layout that hosts the shell screens.

import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuth } from "./AuthProvider.js";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
