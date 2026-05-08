// SPDX-License-Identifier: MIT
//
// `google` connector Module — v2 wrapper around the existing
// Gmail + Calendar clients. Tools mirror v1's most-used actions.
// Niche v1 actions (modify_email, ensure_label, list_history,
// delete_event) stay reachable via the v1 `/api/connectors/actions/*`
// route until the next polish pass.
//
// Phase 7 of task_12. Additive — v1 routes continue to work.

import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors } from "@boringos/db";
import { GmailClient, CalendarClient } from "@boringos/connector-google";
import { refreshOAuthToken } from "../oauth.js";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const GMAIL_SKILL = `Gmail tools.

- \`gmail.list_emails(query?, maxResults?)\` — list recent emails. The
  \`query\` field uses Gmail search syntax (e.g. \`"from:boss is:unread"\`).
  Defaults to inbox if no query is given.
- \`gmail.read_email(messageId)\` — full content of a single email.
- \`gmail.send_email(to, subject, body)\` — send a plain-text email.
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
  if (!row || !row.credentials) return null;
  const accessToken = row.credentials.accessToken;
  if (typeof accessToken !== "string") return null;
  const refreshToken =
    typeof row.credentials.refreshToken === "string"
      ? row.credentials.refreshToken
      : undefined;
  return { rowId: row.id, rawCredentials: row.credentials, accessToken, refreshToken };
}

/**
 * Run a Gmail / Calendar action with OAuth refresh-and-retry.
 *
 * Access tokens last ~1 hour; without this every call past the
 * first hour 401s and the user has to reconnect manually. v1's
 * connector-routes does the same dance — we share
 * `refreshOAuthToken` so both stay in sync.
 */
async function runWithRefresh(
  db: Db,
  tenantId: string,
  toolName: string,
  invokeOnce: (token: string) => Promise<{ success: boolean; data?: unknown; error?: string }>,
): Promise<ToolResult> {
  const creds = await loadGoogleCreds(db, tenantId);
  if (!creds) return denyOnNoCreds(toolName);

  let result = await invokeOnce(creds.accessToken);

  const looks401 =
    !result.success &&
    typeof result.error === "string" &&
    /\b401\b/.test(result.error);

  if (looks401 && creds.refreshToken) {
    const refreshed = await refreshOAuthToken("google", creds.refreshToken);
    if (refreshed) {
      await db
        .update(connectors)
        .set({
          credentials: {
            ...creds.rawCredentials,
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
          },
          updatedAt: new Date(),
        })
        .where(eq(connectors.id, creds.rowId))
        .catch(() => {});
      result = await invokeOnce(refreshed.accessToken);
    }
  }

  return wrapClientResult(result);
}

function denyOnNoCreds(toolName: string): ToolResult {
  return {
    ok: false,
    error: {
      code: "permission_denied",
      message: `Google is not connected for this tenant; cannot run ${toolName}.`,
      retryable: false,
    },
  };
}

function wrapClientResult(result: { success: boolean; data?: unknown; error?: string }): ToolResult {
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: "upstream_unavailable",
        message: result.error ?? "Google API returned an error",
        retryable: false,
      },
    };
  }
  return { ok: true, result: (result.data ?? {}) as Record<string, unknown> };
}

export const createGoogleModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;

  const withGmail = (
    ctx: ToolContext,
    invoke: (client: GmailClient) => Promise<{ success: boolean; data?: unknown; error?: string }>,
    toolName: string,
  ): Promise<ToolResult> =>
    runWithRefresh(db, ctx.tenantId, toolName, (token) =>
      // GmailClient + CalendarClient take the access-token string
      // directly (not a credentials object). v1 routes use the
      // same constructor.
      invoke(new GmailClient(token)),
    );

  const withCalendar = (
    ctx: ToolContext,
    invoke: (client: CalendarClient) => Promise<{ success: boolean; data?: unknown; error?: string }>,
    toolName: string,
  ): Promise<ToolResult> =>
    runWithRefresh(db, ctx.tenantId, toolName, (token) =>
      invoke(new CalendarClient(token)),
    );

  // ── Gmail ──────────────────────────────────────────────────

  const listEmails: Tool = {
    name: "gmail.list_emails",
    description: "List recent Gmail messages, optionally filtered by query",
    inputs: z.object({
      query: z.string().optional(),
      maxResults: z.number().int().positive().optional(),
    }),
    async handler(input: { query?: string; maxResults?: number }, ctx) {
      return withGmail(
        ctx,
        async (client) => client.executeAction("list_emails", input),
        "gmail.list_emails",
      );
    },
  };

  const readEmail: Tool = {
    name: "gmail.read_email",
    description: "Read full content of an email by message ID",
    inputs: z.object({ messageId: z.string() }),
    async handler(input: { messageId: string }, ctx) {
      return withGmail(
        ctx,
        async (client) => client.executeAction("read_email", input),
        "gmail.read_email",
      );
    },
  };

  const sendEmail: Tool = {
    name: "gmail.send_email",
    description: "Send an email through the connected Gmail account",
    inputs: z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    async handler(input: { to: string; subject: string; body: string }, ctx) {
      return withGmail(
        ctx,
        async (client) => client.executeAction("send_email", input),
        "gmail.send_email",
      );
    },
  };

  const searchEmails: Tool = {
    name: "gmail.search_emails",
    description: "Search emails with an explicit Gmail query string",
    inputs: z.object({
      query: z.string(),
      maxResults: z.number().int().positive().optional(),
    }),
    async handler(input: { query: string; maxResults?: number }, ctx) {
      return withGmail(
        ctx,
        async (client) => client.executeAction("search_emails", input),
        "gmail.search_emails",
      );
    },
  };

  // ── Calendar ──────────────────────────────────────────────

  const listEvents: Tool = {
    name: "calendar.list_events",
    description: "List calendar events in an optional time window",
    inputs: z.object({
      timeMin: z.string().optional(),
      timeMax: z.string().optional(),
      maxResults: z.number().int().positive().optional(),
    }),
    async handler(
      input: { timeMin?: string; timeMax?: string; maxResults?: number },
      ctx,
    ) {
      return withCalendar(
        ctx,
        async (client) => client.executeAction("list_events", input),
        "calendar.list_events",
      );
    },
  };

  const createEvent: Tool = {
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
    async handler(
      input: {
        summary: string;
        start: string;
        end: string;
        attendees?: string[];
        description?: string;
        location?: string;
      },
      ctx,
    ) {
      return withCalendar(
        ctx,
        async (client) => client.executeAction("create_event", input),
        "calendar.create_event",
      );
    },
  };

  const updateEvent: Tool = {
    name: "calendar.update_event",
    description: "Update an existing calendar event",
    inputs: z.object({
      eventId: z.string(),
      summary: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      description: z.string().optional(),
    }),
    async handler(
      input: {
        eventId: string;
        summary?: string;
        start?: string;
        end?: string;
        description?: string;
      },
      ctx,
    ) {
      return withCalendar(
        ctx,
        async (client) => client.executeAction("update_event", input),
        "calendar.update_event",
      );
    },
  };

  const findFreeSlots: Tool = {
    name: "calendar.find_free_slots",
    description: "Find open calendar slots in a window",
    inputs: z.object({
      timeMin: z.string(),
      timeMax: z.string(),
      durationMinutes: z.number().int().positive(),
    }),
    async handler(
      input: { timeMin: string; timeMax: string; durationMinutes: number },
      ctx,
    ) {
      return withCalendar(
        ctx,
        async (client) => client.executeAction("find_free_slots", input),
        "calendar.find_free_slots",
      );
    },
  };

  const module: Module = {
    id: "google",
    name: "Google Workspace",
    version: "0.1.0",
    description: "Gmail + Calendar integration",
    provides: ["email-send", "email-search", "calendar"],
    skills: [
      { id: "gmail", source: "module", body: GMAIL_SKILL, priority: 82 },
      { id: "calendar", source: "module", body: CALENDAR_SKILL, priority: 83 },
    ],
    tools: [
      listEmails,
      readEmail,
      sendEmail,
      searchEmails,
      listEvents,
      createEvent,
      updateEvent,
      findFreeSlots,
    ],
  };

  return module;
};
