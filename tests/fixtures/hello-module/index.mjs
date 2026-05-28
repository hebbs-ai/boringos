// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimum-viable Hebbs module — one tool, no schema, no UI.
// Used by tests/hebbs-cli-scaffold-smoke.test.ts to validate the
// MDK T4.3 acceptance path. Will be replaced by `create-hebbs-module`
// scaffolder output once T5.1 lands.

import { z } from "@boringos/module-sdk";

export const createHelloModule = () => ({
  id: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "Demo module — one tool, one skill",
  defaultInstall: false,
  skills: [
    {
      id: "hello",
      source: "module",
      body: "Use `hello.greet` to greet someone by name.",
    },
  ],
  tools: [
    {
      name: "greet",
      description: "Greet someone by name",
      inputs: z.object({ name: z.string() }),
      async handler({ name }) {
        return {
          ok: true,
          result: { greeting: `Hello, ${name}!` },
        };
      },
    },
  ],
});

export default createHelloModule;
