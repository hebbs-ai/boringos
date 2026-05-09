// SPDX-License-Identifier: BUSL-1.1
//
// Small shared building blocks used by every screen.
// Kept deliberately minimal — A9 BrandProvider styles them later.

import type { ReactNode } from "react";

export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="px-8 pt-8 pb-4 border-b border-border-subtle flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-text">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description?: string;
  cta?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h2 className="text-base font-medium text-text">{title}</h2>
      {description && (
        <p className="mt-2 text-sm text-muted max-w-sm">{description}</p>
      )}
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="text-sm text-muted">Loading…</div>
    </div>
  );
}

export function ScreenBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-auto px-8 py-6">{children}</div>;
}
