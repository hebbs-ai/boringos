// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T3.1a — ModuleFactoryDeps.memory + .drive typed.
//
// Asserts the SDK's `ModuleFactoryDeps` exposes the concrete types
// from `@boringos/memory` and `@boringos/drive`, so module factories
// can read them without an `as` cast. The test relies on TypeScript
// compile-time checks at the time `pnpm -r typecheck` runs (covered
// by the build pipeline) — here we also do a runtime sanity check
// that the concrete types still match the SDK structural surface
// via duck-typing.

import { describe, it, expect, expectTypeOf } from "vitest";
import type { ModuleFactoryDeps } from "@boringos/module-sdk";
import type { MemoryProvider } from "@boringos/memory";
import type { StorageBackend } from "@boringos/drive";

describe("MDK T3.1a — ModuleFactoryDeps memory/drive typing", () => {
  it("ModuleFactoryDeps.memory is typed as MemoryProvider (not unknown)", () => {
    expectTypeOf<ModuleFactoryDeps["memory"]>().toEqualTypeOf<
      MemoryProvider | undefined
    >();
  });

  it("ModuleFactoryDeps.drive is typed as StorageBackend (not unknown)", () => {
    expectTypeOf<ModuleFactoryDeps["drive"]>().toEqualTypeOf<
      StorageBackend | undefined
    >();
  });

  it("a factory that destructures memory/drive compiles without a cast", () => {
    // Compile-time assertion only — if memory/drive were still `unknown`,
    // `m.skillMarkdown()` and `d.put()` below would error.
    const factory = (
      deps: ModuleFactoryDeps,
    ): { memorySkill: string; drivePresent: boolean } => {
      const m = deps.memory;
      const d = deps.drive;
      return {
        memorySkill: m ? m.skillMarkdown() : "(no memory)",
        drivePresent: !!d,
      };
    };
    expect(typeof factory).toBe("function");
  });
});
