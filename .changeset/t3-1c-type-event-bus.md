---
"@boringos/module-sdk": minor
---

Extract a narrow `EventBus` interface (just `emit(event)`) plus the `ConnectorEvent` shape into `@boringos/module-sdk`; type `ModuleFactoryDeps.eventBus` with it. Replaces the pre-MDK `unknown` cast pattern. The host's concrete bus in `@boringos/core` keeps the wider `on`/`onAny`/`off` surface for in-process subscribers and structurally implements the SDK interface for module-facing use. CRM's local `CrmEventBus` shim is now redundant and can be retired in Phase 8 / T8.1. MDK T3.1c.
