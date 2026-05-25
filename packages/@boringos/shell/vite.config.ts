import { defineConfig, type Plugin } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// task_22 U4.5 — Import map + named-export shims for runtime-loaded
// plugin bundles.
//
// Bundles in `.hebbsmod` archives are produced with React /
// react-router-dom / @tanstack/react-query / @boringos/ui marked
// EXTERNAL (else every plugin ships its own React copy and hooks break
// across instances). The browser sees bare-specifier imports like
// `import { useState } from "react"` and can't resolve them natively —
// only relative / absolute URLs work without an import map.
//
// Problem layered on top: Vite's pre-optimized React (and friends) are
// CJS-wrapped — `export default require_react()` is the entire module.
// Vite makes named imports work for shell source by REWRITING them at
// transform time, but a runtime-loaded esbuild bundle isn't transformed
// by Vite, so `import { useEffect } from "react"` fails with "does not
// provide an export named 'useEffect'".
//
// Fix: serve synthetic ESM shim modules under /runtime-shims/<spec>.js
// that import the CJS-wrapped default and re-export the named bindings
// the rest of the world expects. The import map then routes the bare
// specifier through the shim.
//
// Specs that Vite already pre-bundles as proper ESM with named exports
// (`@boringos/ui`, `react-router-dom`, `@tanstack/react-query`) skip
// the shim and map directly to the .vite/deps file.

// Named exports we need to expose for each CJS-wrapped dep. Entries
// missing on a given version come through as `undefined`, which is fine
// — only fails if a consumer actually references them.
const SHIM_EXPORTS: Record<string, readonly string[]> = {
  react: [
    "useState",
    "useEffect",
    "useMemo",
    "useCallback",
    "useRef",
    "useContext",
    "useReducer",
    "useLayoutEffect",
    "useImperativeHandle",
    "useDebugValue",
    "useTransition",
    "useDeferredValue",
    "useId",
    "useSyncExternalStore",
    "useInsertionEffect",
    "useActionState",
    "useOptimistic",
    "useFormStatus",
    "createContext",
    "createElement",
    "cloneElement",
    "isValidElement",
    "Children",
    "Component",
    "PureComponent",
    "Fragment",
    "StrictMode",
    "Suspense",
    "lazy",
    "memo",
    "forwardRef",
    "startTransition",
    "version",
  ],
  "react/jsx-runtime": ["jsx", "jsxs", "jsxDEV", "Fragment"],
  "react/jsx-dev-runtime": ["jsx", "jsxs", "jsxDEV", "Fragment"],
  "react-dom": [
    "render",
    "unmountComponentAtNode",
    "flushSync",
    "createPortal",
    "findDOMNode",
    "version",
  ],
  "react-dom/client": ["createRoot", "hydrateRoot"],
};

// Specs that need an import-map entry but pre-bundle as proper ESM —
// the import map points straight at the Vite dep URL, no shim.
const ESM_PASSTHROUGH = [
  "react-router-dom",
  "@tanstack/react-query",
  "@boringos/ui",
  "@boringos/workflow-ui",
];

const ALL_EXTERNALS = [...Object.keys(SHIM_EXPORTS), ...ESM_PASSTHROUGH];

function readMetadata():
  | {
      hash: string;
      browserHash: string;
      optimized: Record<string, { file: string }>;
    }
  | null {
  const metaPath = resolve(
    process.cwd(),
    "node_modules/.vite/deps/_metadata.json",
  );
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, "utf8"));
}

// CRITICAL: use `browserHash`, NOT `hash`.
//
//   - `meta.hash`        — Vite optimizer's internal "are deps stale?"
//                          stamp. Changes when the resolved dep set
//                          changes; doesn't appear in the URLs Vite
//                          serves.
//   - `meta.browserHash` — the actual `?v=` cache-buster Vite stamps
//                          onto every dep URL it serves to the browser
//                          (e.g. `import "react"` in shell source gets
//                          rewritten to `react.js?v=<browserHash>`).
//
// If we build the import map's URLs with `hash` while the host shell's
// own imports use `browserHash`, the browser sees two distinct URLs
// for the same React (`react.js?v=<hash>` and `react.js?v=<browserHash>`)
// and module-caches them as TWO modules. Each one carries its own
// React internals chunk → two dispatcher singletons → "Invalid hook
// call / Cannot read 'useState' of null" the moment a runtime-loaded
// `.hebbsmod` plugin renders. Aligning to `browserHash` keeps every
// React import in the page resolving to one module.
function depUrlFor(spec: string): string | null {
  const meta = readMetadata();
  if (!meta) return null;
  const entry = meta.optimized?.[spec];
  if (!entry) return null;
  const file = entry.file.split("/").pop();
  return `/node_modules/.vite/deps/${file}?v=${meta.browserHash}`;
}

function buildShim(spec: string): string | null {
  const exportsList = SHIM_EXPORTS[spec];
  if (!exportsList) return null;
  const target = depUrlFor(spec);
  if (!target) return null;
  const lines: string[] = [
    `import M from ${JSON.stringify(target)};`,
    `export default M;`,
  ];
  for (const name of exportsList) {
    // Use bracket access so non-identifier names would still work, and
    // emit one export per binding so static analysis sees them.
    lines.push(`export const ${name} = M[${JSON.stringify(name)}];`);
  }
  return lines.join("\n") + "\n";
}

function runtimePluginImportMap(): Plugin {
  return {
    name: "boringos:runtime-plugin-import-map",
    configureServer(server) {
      // Synthesize /runtime-shims/<encodedSpec>.js on demand. The shim
      // is a tiny ESM wrapper that re-exports named bindings from the
      // CJS-wrapped default of the underlying .vite/deps file.
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/runtime-shims/")) return next();
        // Strip prefix + ".js" + optional query string.
        const encoded = url
          .slice("/runtime-shims/".length)
          .replace(/\.js(\?.*)?$/, "");
        const spec = decodeURIComponent(encoded);
        const body = buildShim(spec);
        if (body === null) {
          res.statusCode = 404;
          res.end(`no shim for ${spec}`);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
        res.end(body);
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        const meta = readMetadata();
        if (!meta) return [];
        const imports: Record<string, string> = {};
        // See `depUrlFor` for the `browserHash` vs `hash` rationale.
        // tl;dr — `browserHash` matches the URL Vite uses for the
        // host shell's own React imports, so the browser dedupes
        // host + plugin React into a single module instance.
        const v = meta.browserHash;
        for (const spec of ALL_EXTERNALS) {
          const entry = meta.optimized?.[spec];
          if (!entry) continue;
          if (SHIM_EXPORTS[spec]) {
            // CJS-wrapped — go through shim so named imports resolve.
            imports[spec] = `/runtime-shims/${encodeURIComponent(spec)}.js?v=${v}`;
          } else {
            const file = entry.file.split("/").pop();
            imports[spec] = `/node_modules/.vite/deps/${file}?v=${v}`;
          }
        }
        if (Object.keys(imports).length === 0) return [];
        return [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: JSON.stringify({ imports }, null, 2),
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}

export default defineConfig({
  plugins: [runtimePluginImportMap(), react(), tailwindcss()],
  optimizeDeps: {
    // Force these into the pre-bundle so the import map above has
    // stable URLs to point at — they'd otherwise be served on-demand
    // from /@fs/ paths that the browser can't resolve via bare
    // specifier.
    include: ["@boringos/ui", "@boringos/workflow-ui"],
  },
  server: {
    port: 5174,
    host: "0.0.0.0",
    allowedHosts: ["shell.boringos.dev"],
    proxy: {
      "/api": {
        target: process.env.BORINGOS_API_TARGET ?? "http://localhost:3030",
        changeOrigin: true,
      },
      // task_22 U4.5 — runtime-loaded module UIs live at
      // /modules/<id>/ui/<rest> on the framework. Proxy in dev so
      // `import("/modules/<id>/ui/index.mjs")` from the shell
      // reaches the host. The bare `/modules` SPA route (Apps
      // screen) is NOT proxied — only `/modules/<id>/ui/*` is.
      "^/modules/[^/]+/ui/.*": {
        target: process.env.BORINGOS_API_TARGET ?? "http://localhost:3030",
        changeOrigin: true,
      },
    },
  },
});
