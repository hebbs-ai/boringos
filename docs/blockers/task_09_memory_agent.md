# Blocker (parked) — Memory as a dedicated agent

**Status:** parked. Build after the User Copilot ships; Copilot
treats memory as a black-box service in the meantime.

Memory becomes its own agent (not a passive store) — interacts
with every other agent over the standard tool/callback surface,
owns the read/write/forget/scope decisions, and exposes a single
clean API the rest of the system uses without thinking about
storage.
