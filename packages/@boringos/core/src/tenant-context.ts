// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-tool-call tenant context threading via AsyncLocalStorage.
//
// The AuthManager needs a tenantId to resolve credentials, but
// ModuleFactoryDeps.getConnectorToken does not carry tenantId in its
// public signature (it would leak internal infrastructure to module
// authors). AsyncLocalStorage bridges the gap: the tool dispatcher
// sets the tenantId for the duration of each call; the deps closures
// read it from here.
//
// Usage:
//   Setting:  tenantContext.run(tenantId, async () => { ... })
//   Reading:  tenantContext.getStore() ?? throw
//
// The storage is module-level so that boringos.ts constructs the
// factoryDeps closure once and the tool-routes reads the same store.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient tenant context for the duration of a dispatched tool call.
 * Set by the tool dispatcher before calling dispatch(); read by
 * ModuleFactoryDeps auth helpers.
 */
export const tenantContext = new AsyncLocalStorage<string>();

/**
 * Read the current tenant id from the ambient context.
 * Throws if called outside a tool-dispatch context.
 */
export function requireTenantId(): string {
  const id = tenantContext.getStore();
  if (!id) {
    throw new Error(
      "Connector auth helpers (getConnectorToken, listConnectedAccounts, checkScopes) " +
        "must be called from within a dispatched tool handler.",
    );
  }
  return id;
}
