// SPDX-License-Identifier: MIT
//
// Google Workspace HTTP clients. The v1 `ConnectorDefinition`
// wrapper + `default-workflows.ts` were deleted with the
// connector framework — these clients are imported directly by
// the v2 `google` Module in `@boringos/core/src/v2-modules/`.

export {
  GmailClient,
  buildOutgoingMime,
  encodeQuotedPrintable,
  type EmailHeaders,
} from "./gmail-client.js";
export { CalendarClient } from "./calendar-client.js";
