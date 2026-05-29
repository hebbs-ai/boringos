// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Programmatic entry for the Hebbs CLI. The binary at
// `dist/cli.js` is a thin wrapper that imports from here, so unit
// tests can drive `runTest()` directly without spawning a subprocess.
//
// MDK T4.2.

export { runTest, type TestOptions, type TestResult } from "./test.js";
export { startDev, type DevOptions, type DevHandle } from "./dev.js";
export {
  runDoctor,
  type DoctorOptions,
  type DoctorReport,
  type DoctorFinding,
} from "./doctor.js";
export {
  runCodemod,
  bundledCodemods,
  moduleUiToPluginUi,
  type Codemod,
  type CodemodContext,
  type CodemodRunResult,
  type RunOptions as CodemodRunOptions,
} from "./codemods/index.js";
