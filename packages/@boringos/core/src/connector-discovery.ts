// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dynamic connector discovery. Finds installed @boringos/connector-*
// packages and imports each one's `<provider>Connector` export.
//
// Convention:
//   - Package name:   @boringos/connector-<provider>
//   - Export name:    <provider>Connector  (e.g. googleConnector, slackConnector)
//   - Export shape:   ConnectorDefinition from @boringos/module-sdk
//
// The host scans process.cwd()/node_modules/@boringos/ at startup. Whatever
// connector packages are installed via npm/pnpm are auto-registered with
// AuthManager. To remove a connector, uninstall the package and restart.
//
// For custom connectors (not under @boringos/), use the explicit builder
// hook: app.connector(myCustomConnector).

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ConnectorDefinition } from "@boringos/module-sdk";

export interface DiscoveredConnector {
  packageName: string;
  provider: string;
  definition: ConnectorDefinition;
}

/**
 * Scan node_modules/@boringos/ for connector-* packages. For each, dynamic-
 * import and look for the convention-named `<provider>Connector` export.
 *
 * Search roots, in order:
 *   1. <cwd>/node_modules/@boringos/
 *   2. <cwd>/node_modules/@boringos/core/node_modules/@boringos/  (pnpm style)
 *
 * Returns an empty array when no @boringos directory exists.
 */
export async function discoverConnectors(
  cwd: string = process.cwd(),
): Promise<DiscoveredConnector[]> {
  const roots = [
    join(cwd, "node_modules", "@boringos"),
    join(cwd, "node_modules", "@boringos", "core", "node_modules", "@boringos"),
  ];

  const seen = new Set<string>();
  const found: DiscoveredConnector[] = [];

  for (const root of roots) {
    let dirs: string[];
    try {
      dirs = await readdir(root);
    } catch {
      continue;
    }

    for (const dir of dirs) {
      if (!dir.startsWith("connector-")) continue;
      const packageName = `@boringos/${dir}`;
      if (seen.has(packageName)) continue;
      seen.add(packageName);

      const provider = dir.slice("connector-".length);
      const exportName = `${provider}Connector`;

      try {
        const mod = (await import(packageName)) as Record<string, unknown>;
        const def = mod[exportName];
        if (
          def &&
          typeof def === "object" &&
          typeof (def as { provider?: unknown }).provider === "string"
        ) {
          found.push({
            packageName,
            provider,
            definition: def as ConnectorDefinition,
          });
        } else {
          console.warn(
            `[connector-discovery] ${packageName} loaded but no '${exportName}' export with a string 'provider' field was found. Skipping.`,
          );
        }
      } catch (err) {
        console.warn(
          `[connector-discovery] failed to load ${packageName}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return found;
}
