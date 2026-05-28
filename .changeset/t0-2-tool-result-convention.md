---
"@boringos/module-sdk": patch
---

Hoist the tool result payload convention into `TOOLS.md` and `module-sdk/README.md` as a first-class rule (list-style tools return a named-key object keyed by the plural resource; singular tools return the value directly). Closes the "Tool result shape convention" bullet in #61. Pure documentation — no API or runtime changes.
