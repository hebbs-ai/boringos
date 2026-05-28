// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.1c — minimal `EventBus` contract for `ModuleFactoryDeps`.
//
// The concrete bus lives in `@boringos/core` and adds `on`/`onAny`/
// `off` for host-side subscribers. Modules only call `.emit()` to
// fire cross-app events (a connector announces a Gmail thread,
// triage labels it, CRM ingests as a lead). This narrow interface
// is the type module-sdk exposes via `ModuleFactoryDeps.eventBus`,
// so the SDK can stay cycle-free from `@boringos/core`.
//
// Shape matches `@boringos/core/src/event-bus.ts` exactly — no
// behavioural divergence; the SDK simply omits the host-only
// subscribe surface from the modules-facing type.

/**
 * Cross-app event shape carried by the host's `EventBus`. Sent by
 * connectors and modules; consumed by workflows, inbox routers,
 * and app-level subscribers.
 */
export interface ConnectorEvent {
  /** Originating module / connector kind, e.g. "google", "slack", "crm". */
  connectorKind: string;
  /** Event type, e.g. "email_received", "lead_created". */
  type: string;
  /** Tenant the event is scoped to. */
  tenantId: string;
  /** Free-form payload subscribers consume. */
  data: Record<string, unknown>;
  /** When the event happened. */
  timestamp: Date;
}

/**
 * Narrow surface module factories see — just `emit`. The host's
 * concrete bus implements this structurally and adds the
 * subscribe / unsubscribe methods used only by core.
 */
export interface EventBus {
  emit(event: ConnectorEvent): Promise<void>;
}
