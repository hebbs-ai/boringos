// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.1c — ModuleFactoryDeps.eventBus typed via module-sdk's
// minimal `EventBus` interface; core's concrete bus structurally
// implements it (adds host-only on/onAny/off).

import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  ModuleFactoryDeps,
  EventBus,
  ConnectorEvent,
} from "@boringos/module-sdk";
import { createEventBus } from "@boringos/core";

describe("MDK T3.1c — ModuleFactoryDeps.eventBus typing", () => {
  it("ModuleFactoryDeps.eventBus is typed as EventBus, not unknown", () => {
    expectTypeOf<ModuleFactoryDeps["eventBus"]>().toEqualTypeOf<
      EventBus | undefined
    >();
  });

  it("a factory that calls eventBus.emit compiles without a cast", () => {
    const factory = async (deps: ModuleFactoryDeps): Promise<void> => {
      const bus = deps.eventBus;
      if (!bus) return;
      await bus.emit({
        connectorKind: "crm",
        type: "lead_created",
        tenantId: "00000000-0000-0000-0000-000000000000",
        data: { leadId: "l-1" },
        timestamp: new Date(),
      });
    };
    expect(typeof factory).toBe("function");
  });

  it("core's concrete EventBus is assignable to the SDK's narrow interface", () => {
    const bus = createEventBus();
    const narrow: EventBus = bus;
    expect(narrow.emit).toBe(bus.emit);
  });

  it("emit fires subscribers in core's full implementation", async () => {
    const bus = createEventBus();
    const received: ConnectorEvent[] = [];
    bus.on("ping", (e) => {
      received.push(e);
    });
    await bus.emit({
      connectorKind: "demo",
      type: "ping",
      tenantId: "tenant-x",
      data: { count: 1 },
      timestamp: new Date(),
    });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("ping");
  });
});
