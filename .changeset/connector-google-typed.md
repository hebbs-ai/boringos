---
"@boringos/connector-google": major
---

BREAKING: removed legacy `executeAction`-based `GmailClient` and `CalendarClient` classes. Use typed methods (`listMessages`, `sendEmail`, `listEvents`, `createEvent`, etc.) instead. The exports now point to what was previously `GmailClientV2`/`CalendarClientV2`.

Major version bump reflects the API break. Token-provider constructor and typed methods are documented in the package README and skill files.
