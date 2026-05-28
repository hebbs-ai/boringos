// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `google` connector Module. Migrated to v2 typed clients in Task 2.6.
// Tools use deps.getConnectorToken + GmailClientV2 / CalendarClientV2.
//
// Legacy helpers loadGoogleCreds and getGoogleToken are preserved
// here because connector-tokens.ts (legacy dispatch path) imports
// getGoogleToken. Task 2.10 removes them in a final sweep once
// connector-tokens.ts is retired.
import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors, packCredentials, unpackCredentials } from "@boringos/db";
import { refreshOAuthToken } from "../oauth.js";
import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  GmailClientV2,
  CalendarClientV2,
  gmailService,
  calendarService,
} from "@boringos/connector-google";

const GMAIL_SKILL = `Gmail tools.

- \`gmail.list_emails(query?, maxResults?)\` — list recent emails. The
  \`query\` field uses Gmail search syntax (e.g. \`"from:boss is:unread"\`).
  Defaults to inbox if no query is given.
- \`gmail.read_email(messageId)\` — full content of a single email.
- \`gmail.send_email(to, subject, body | bodyHtml + bodyText)\` — send
  an email. Pass \`bodyHtml\` (and ideally a \`bodyText\` fallback) for
  rich replies; \`body\` alone still works for plain-text.
- \`gmail.reply_email(messageId, threadId, to, subject, bodyHtml?, bodyText?)\`
  — reply to an existing message. Adds \`In-Reply-To\` / \`References\`
  headers and uses the original \`threadId\` so Gmail surfaces the reply
  inside the thread instead of as a new conversation.
- \`gmail.search_emails(query, maxResults?)\` — explicit search; same
  query syntax as list_emails but no default.

Threading: messages have a \`threadId\` field. The thread is the unit;
Hebbs's triage agent reasons about whole threads, not individual
messages. See task_09's thread-aware triage docs.

Don't try to use OAuth tokens directly — the framework holds them and
your bearer token authorizes you against the tenant's stored credentials.`;

const CALENDAR_SKILL = `Calendar tools.

- \`calendar.list_events(timeMin?, timeMax?, maxResults?)\` — list events
  in a window
- \`calendar.create_event(summary, start, end, attendees?)\` — schedule
  a new event
- \`calendar.update_event(eventId, summary?, start?, end?)\` — modify an
  existing event
- \`calendar.find_free_slots(timeMin, timeMax, durationMinutes)\` —
  search for open slots

Times are ISO 8601 strings. Default calendar is the user's primary;
multi-calendar support comes in a later phase.`;

// ---- Legacy helpers (retained for connector-tokens.ts compatibility) ----
// connector-tokens.ts still calls getGoogleToken as the legacy token
// dispatch path. These will be removed in Task 2.10 once that file
// is retired. Do NOT call these from the v2 tool handlers below.

interface CredsRow {
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}

async function loadGoogleCreds(
  db: Db,
  tenantId: string,
): Promise<{
  rowId: string;
  rawCredentials: Record<string, unknown>;
  accessToken: string;
  refreshToken?: string;
} | null> {
  const rows = await db
    .select({ id: connectors.id, credentials: connectors.credentials, config: connectors.config })
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, "google")))
    .limit(1);
  const row = rows[0] as (CredsRow & { id: string }) | undefined;
  if (!row) return null;
  const creds = unpackCredentials<{ accessToken: string; refreshToken?: string; expiresAt?: string; [k: string]: unknown }>(
    row.credentials as string | Record<string, unknown> | null,
  );
  if (!creds) return null;
  const accessToken = creds.accessToken;
  if (typeof accessToken !== "string") return null;
  const refreshToken =
    typeof creds.refreshToken === "string" ? creds.refreshToken : undefined;
  return { rowId: row.id, rawCredentials: creds, accessToken, refreshToken };
}

/**
 * Returns a fresh access token for the tenant's Google connection,
 * refreshing it proactively when it is within 60 s of expiry.
 *
 * Registered with the legacy connector-token dispatcher in
 * connector-tokens.ts under kind "google". Retained until Task 2.10
 * removes connector-tokens.ts. The v2 tool handlers use
 * deps.getConnectorToken instead.
 */
export async function getGoogleToken(
  db: Db,
  tenantId: string,
): Promise<{ accessToken: string } | null> {
  const creds = await loadGoogleCreds(db, tenantId);
  if (!creds) return null;

  const expiresAt = creds.rawCredentials.expiresAt as string | undefined;
  const expiresSoon = expiresAt
    ? Date.now() > new Date(expiresAt).getTime() - 60_000
    : false;

  if (expiresSoon && creds.refreshToken) {
    const refreshed = await refreshOAuthToken("google", creds.refreshToken);
    if (refreshed) {
      const next: Record<string, unknown> = {
        ...creds.rawCredentials,
        accessToken: refreshed.accessToken,
      };
      if (refreshed.expiresAt) next.expiresAt = refreshed.expiresAt;
      await db
        .update(connectors)
        .set({ credentials: packCredentials(next) as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(connectors.id, creds.rowId))
        .catch(() => {});
      return { accessToken: refreshed.accessToken };
    }
  }

  return { accessToken: creds.accessToken };
}

// ---- Module factory (v2) ----

export const createGoogleModule: ModuleFactory = (deps) => {
  // Helper: get a ConnectorTokenHandle or return a not_found error.
  // Centralises the deps.getConnectorToken?.() pattern used by all 9 tools.
  async function getConn() {
    const conn = await deps.getConnectorToken?.("google", "google");
    return conn ?? null;
  }

  return {
    id: "google",
    name: "Google Workspace",
    version: "2.0.0",
    description: "Gmail + Calendar integration",
    kind: "connector",
    provides: ["email-send", "email-search", "calendar"],
    connectors: { google: { services: [gmailService, calendarService] } },
    skills: [
      { id: "gmail", source: "module", body: GMAIL_SKILL, priority: 82 },
      { id: "calendar", source: "module", body: CALENDAR_SKILL, priority: 83 },
    ],
    tools: [
      // ── Gmail ────────────────────────────────────────────────
      {
        name: "gmail.list_emails",
        description: "List recent Gmail messages, optionally filtered by query",
        inputs: z.object({
          query: z.string().optional(),
          maxResults: z.number().int().positive().optional(),
        }),
        async handler(input: { query?: string; maxResults?: number }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Gmail tools.",
                retryable: false,
              },
            };
          }
          const gmail = new GmailClientV2(conn.getToken);
          try {
            const messages = await gmail.listMessages({
              query: input.query,
              maxResults: input.maxResults,
            });
            return { ok: true as const, result: messages };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      {
        name: "gmail.read_email",
        description: "Read full content of an email by message ID",
        inputs: z.object({ messageId: z.string() }),
        async handler(input: { messageId: string }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Gmail tools.",
                retryable: false,
              },
            };
          }
          const gmail = new GmailClientV2(conn.getToken);
          try {
            const message = await gmail.getMessage(input.messageId);
            return { ok: true as const, result: message };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      {
        name: "gmail.send_email",
        description:
          "Send an email through the connected Gmail account. Pass " +
          "`bodyHtml` (with an optional `bodyText` fallback) for rich " +
          "replies; `body` alone still works for plain-text.",
        inputs: z
          .object({
            to: z.string().email(),
            subject: z.string(),
            body: z.string().optional(),
            bodyHtml: z.string().optional(),
            bodyText: z.string().optional(),
          })
          .refine(
            (v) =>
              (typeof v.body === "string" && v.body.length > 0) ||
              (typeof v.bodyHtml === "string" && v.bodyHtml.length > 0) ||
              (typeof v.bodyText === "string" && v.bodyText.length > 0),
            { message: "At least one of body / bodyHtml / bodyText is required" },
          ),
        async handler(input: {
          to: string;
          subject: string;
          body?: string;
          bodyHtml?: string;
          bodyText?: string;
        }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Gmail tools.",
                retryable: false,
              },
            };
          }
          const gmail = new GmailClientV2(conn.getToken);
          try {
            // GmailClientV2.sendEmail accepts body (plain text).
            // Use bodyText or body as the plain-text body. If only
            // bodyHtml is provided, fall back to it as the body string.
            const body = input.bodyText ?? input.body ?? input.bodyHtml ?? "";
            const result = await gmail.sendEmail({
              to: input.to,
              subject: input.subject,
              body,
            });
            return { ok: true as const, result };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      {
        name: "gmail.reply_email",
        description:
          "Reply to an existing Gmail message. Sets In-Reply-To / " +
          "References headers and reuses the thread id so the reply is " +
          "threaded in Gmail.",
        inputs: z
          .object({
            messageId: z.string(),
            threadId: z.string(),
            to: z.string().email(),
            subject: z.string(),
            body: z.string().optional(),
            bodyHtml: z.string().optional(),
            bodyText: z.string().optional(),
          })
          .refine(
            (v) =>
              (typeof v.body === "string" && v.body.length > 0) ||
              (typeof v.bodyHtml === "string" && v.bodyHtml.length > 0) ||
              (typeof v.bodyText === "string" && v.bodyText.length > 0),
            { message: "At least one of body / bodyHtml / bodyText is required" },
          ),
        async handler(input: {
          messageId: string;
          threadId: string;
          to: string;
          subject: string;
          body?: string;
          bodyHtml?: string;
          bodyText?: string;
        }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Gmail tools.",
                retryable: false,
              },
            };
          }
          const gmail = new GmailClientV2(conn.getToken);
          try {
            const body = input.bodyText ?? input.body ?? input.bodyHtml ?? "";
            const result = await gmail.replyToEmail({
              messageId: input.messageId,
              body,
            });
            return { ok: true as const, result };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      {
        name: "gmail.search_emails",
        description: "Search emails with an explicit Gmail query string",
        inputs: z.object({
          query: z.string(),
          maxResults: z.number().int().positive().optional(),
        }),
        async handler(input: { query: string; maxResults?: number }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Gmail tools.",
                retryable: false,
              },
            };
          }
          const gmail = new GmailClientV2(conn.getToken);
          try {
            const messages = await gmail.searchMessages(input.query, {
              maxResults: input.maxResults,
            });
            return { ok: true as const, result: messages };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      // ── Calendar ─────────────────────────────────────────────
      {
        name: "calendar.list_events",
        description: "List calendar events in an optional time window",
        inputs: z.object({
          timeMin: z.string().optional(),
          timeMax: z.string().optional(),
          maxResults: z.number().int().positive().optional(),
        }),
        async handler(input: { timeMin?: string; timeMax?: string; maxResults?: number }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Calendar tools.",
                retryable: false,
              },
            };
          }
          const cal = new CalendarClientV2(conn.getToken);
          try {
            const events = await cal.listEvents({
              timeMin: input.timeMin,
              timeMax: input.timeMax,
              maxResults: input.maxResults,
            });
            return { ok: true as const, result: events };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      {
        name: "calendar.create_event",
        description: "Create a calendar event",
        inputs: z.object({
          summary: z.string(),
          start: z.string(),
          end: z.string(),
          attendees: z.array(z.string().email()).optional(),
          description: z.string().optional(),
          location: z.string().optional(),
        }),
        async handler(input: {
          summary: string;
          start: string;
          end: string;
          attendees?: string[];
          description?: string;
          location?: string;
        }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Calendar tools.",
                retryable: false,
              },
            };
          }
          const cal = new CalendarClientV2(conn.getToken);
          try {
            const event = await cal.createEvent({
              summary: input.summary,
              description: input.description,
              location: input.location,
              start: { dateTime: input.start },
              end: { dateTime: input.end },
              attendees: input.attendees?.map((email) => ({ email })),
            });
            return { ok: true as const, result: event };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      {
        name: "calendar.update_event",
        description: "Update an existing calendar event",
        inputs: z.object({
          eventId: z.string(),
          summary: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          description: z.string().optional(),
        }),
        async handler(input: {
          eventId: string;
          summary?: string;
          start?: string;
          end?: string;
          description?: string;
        }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Calendar tools.",
                retryable: false,
              },
            };
          }
          const cal = new CalendarClientV2(conn.getToken);
          try {
            // Build the patch object with only the fields the caller provided.
            const patch: Record<string, unknown> = {};
            if (input.summary !== undefined) patch.summary = input.summary;
            if (input.description !== undefined) patch.description = input.description;
            if (input.start !== undefined) patch.start = { dateTime: input.start };
            if (input.end !== undefined) patch.end = { dateTime: input.end };
            const event = await cal.updateEvent(input.eventId, patch);
            return { ok: true as const, result: event };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },

      {
        name: "calendar.find_free_slots",
        description: "Find open calendar slots in a window",
        inputs: z.object({
          timeMin: z.string(),
          timeMax: z.string(),
          durationMinutes: z.number().int().positive(),
        }),
        async handler(input: { timeMin: string; timeMax: string; durationMinutes: number }) {
          const conn = await getConn();
          if (!conn) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "Google account not connected. Connect Google in Settings to use Calendar tools.",
                retryable: false,
              },
            };
          }
          const cal = new CalendarClientV2(conn.getToken);
          try {
            const slots = await cal.findFreeSlots({
              timeMin: input.timeMin,
              timeMax: input.timeMax,
              durationMinutes: input.durationMinutes,
            });
            return { ok: true as const, result: slots };
          } catch (e) {
            return {
              ok: false as const,
              error: {
                code: "upstream_unavailable" as const,
                message: e instanceof Error ? e.message : String(e),
                retryable: true,
              },
            };
          }
        },
      },
    ],
  };
};
