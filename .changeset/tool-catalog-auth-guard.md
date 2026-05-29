---
"@boringos/agent": minor
---

Framework-level "do not introspect env vars" guard in the tool-catalog provider.

Pi's bash sandbox (and likely other runtimes' sandboxes) redact secrets from `printenv` / `env` while keeping them available to shell interpolation. gpt-class models sometimes choose `printenv BORINGOS_CALLBACK_TOKEN` to "verify" auth, see empty, and refuse to call tools — burning a whole run.

Caught live on 2026-05-29: Pi + the CRM `enrichment-contact` persona. Two of three CRM enrichment agents (Company + Deal) used `echo $VAR` and worked; the third used `printenv` and gave up. After clearing the stale session + adding the guard, Contact Enrichment ran end-to-end and wrote the Ashish Sinha dossier.

Now every agent on every module sees the warning in its system prompt — no need for each persona's `SKILL.md` to repeat it. CRM SKILL.md still carries a per-persona reminder as belt-and-braces.
