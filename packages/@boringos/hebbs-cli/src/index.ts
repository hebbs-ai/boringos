// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Programmatic entry for the Hebbs CLI. The binary at
// `dist/cli.js` is a thin wrapper that imports from here, so unit
// tests can drive `runTest()` directly without spawning a subprocess.
//
// MDK T4.2.

export { runTest, type TestOptions, type TestResult } from "./test.js";
