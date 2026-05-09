// SPDX-License-Identifier: MIT
//
// Lightweight in-process event bus. Connectors (and v2 modules)
// emit events; subscribers (workflows, inbox routers, app-level
// hooks) react. Moved here from `@boringos/connector` when that
// package was deleted — events aren't a "connector" concept,
// they're a generic pub/sub primitive the framework needs.

export interface ConnectorEvent {
  /** Originating module / connector kind, e.g. "google", "slack". */
  connectorKind: string;
  /** Event type, e.g. "email_received", "message_received". */
  type: string;
  tenantId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export type EventHandler = (event: ConnectorEvent) => void | Promise<void>;

export interface EventBus {
  emit(event: ConnectorEvent): Promise<void>;
  on(type: string, handler: EventHandler): void;
  onAny(handler: EventHandler): void;
  off(type: string, handler: EventHandler): void;
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  const globalHandlers = new Set<EventHandler>();

  return {
    async emit(event) {
      const typed = handlers.get(event.type);
      if (typed) {
        for (const h of typed) {
          try { await h(event); } catch { /* handler errors are isolated */ }
        }
      }
      for (const h of globalHandlers) {
        try { await h(event); } catch { /* same */ }
      }
    },

    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },

    onAny(handler) {
      globalHandlers.add(handler);
    },

    off(type, handler) {
      handlers.get(type)?.delete(handler);
    },
  };
}
