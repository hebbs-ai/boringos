// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Built-in Google Workspace module. Thin wrapper that exposes
// `gmail.*` and `calendar.*` tools using the @boringos/connector-google
// SDK. Provides the default tool surface the Shell calendar + inbox
// screens depend on.
//
// Third-party modules can ship their own purpose-specific tools using
// the same SDK without conflicting with these defaults.

import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  GmailClient,
  CalendarClient,
  gmailService,
  calendarService,
} from "@boringos/connector-google";

const MODULE_ID = "google";

const notConnected = () => ({
  ok: false as const,
  error: { code: "not_found" as const, message: "Google account not connected", retryable: false },
});

const upstreamFail = (err: unknown) => ({
  ok: false as const,
  error: {
    code: "upstream_unavailable" as const,
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  },
});

export const createGoogleModule: ModuleFactory = (deps) => ({
  id: MODULE_ID,
  name: "Google Workspace",
  version: "2.0.0",
  description: "Default Gmail and Calendar tools, wrapping @boringos/connector-google",
  kind: "connector",
  connectors: {
    google: { services: [gmailService, calendarService] },
  },
  tools: [
    {
      name: "gmail.list_emails",
      description: "List recent Gmail messages, optionally filtered by query",
      inputs: z.object({
        query: z.string().optional(),
        maxResults: z.number().optional(),
      }),
      async handler(input: { query?: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const gmail = new GmailClient(conn.getToken);
          const messages = await gmail.listMessages({ query: input.query, maxResults: input.maxResults });
          // List-style tool — named-key result. See TOOLS.md → Result
          // payload convention (hoisted in T0.2; this comment is now a
          // pointer rather than the spec).
          return { ok: true as const, result: { messages } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "gmail.read_email",
      description: "Read full content of an email by message ID",
      inputs: z.object({ messageId: z.string() }),
      async handler(input: { messageId: string }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const gmail = new GmailClient(conn.getToken);
          const message = await gmail.getMessage(input.messageId);
          return { ok: true as const, result: message };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "gmail.send_email",
      description: "Send an email through the connected Gmail account",
      inputs: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      }),
      async handler(input: { to: string; subject: string; body: string }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const gmail = new GmailClient(conn.getToken);
          const result = await gmail.sendEmail(input);
          return { ok: true as const, result };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "gmail.reply_email",
      description: "Reply to an existing Gmail message",
      inputs: z.object({ messageId: z.string(), body: z.string() }),
      async handler(input: { messageId: string; body: string }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const gmail = new GmailClient(conn.getToken);
          const result = await gmail.replyToEmail(input);
          return { ok: true as const, result };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "gmail.search_emails",
      description: "Search emails with an explicit Gmail query string",
      inputs: z.object({ query: z.string(), maxResults: z.number().optional() }),
      async handler(input: { query: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const gmail = new GmailClient(conn.getToken);
          const messages = await gmail.searchMessages(input.query, { maxResults: input.maxResults });
          return { ok: true as const, result: { messages } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.list_events",
      description: "List calendar events in an optional time window",
      inputs: z.object({
        timeMin: z.string().optional(),
        timeMax: z.string().optional(),
        maxResults: z.number().optional(),
      }),
      async handler(input: { timeMin?: string; timeMax?: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const events = await cal.listEvents(input);
          // Wrapped shape: Shell expects result.data.events for backward compat
          // with the legacy executeAction return.
          return { ok: true as const, result: { events } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.create_event",
      description: "Create a calendar event",
      inputs: z.object({
        summary: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        description: z.string().optional(),
        attendees: z.array(z.string()).optional(),
        timeZone: z.string().optional(),
      }),
      async handler(input: { summary: string; startTime: string; endTime: string; description?: string; attendees?: string[]; timeZone?: string }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const event = await cal.createEvent({
            summary: input.summary,
            description: input.description,
            start: { dateTime: input.startTime, timeZone: input.timeZone ?? "UTC" },
            end: { dateTime: input.endTime, timeZone: input.timeZone ?? "UTC" },
            attendees: input.attendees?.map((email) => ({ email })),
          });
          return { ok: true as const, result: event };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.update_event",
      description: "Update an existing calendar event",
      inputs: z.object({
        eventId: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
      async handler(input: { eventId: string; summary?: string; description?: string; startTime?: string; endTime?: string }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const patch: Record<string, unknown> = {};
          if (input.summary !== undefined) patch.summary = input.summary;
          if (input.description !== undefined) patch.description = input.description;
          if (input.startTime) patch.start = { dateTime: input.startTime };
          if (input.endTime) patch.end = { dateTime: input.endTime };
          const event = await cal.updateEvent(input.eventId, patch);
          return { ok: true as const, result: event };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.find_free_slots",
      description: "Find open calendar slots in a window",
      inputs: z.object({
        timeMin: z.string(),
        timeMax: z.string(),
        durationMinutes: z.number(),
      }),
      async handler(input: { timeMin: string; timeMax: string; durationMinutes: number }) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const slots = await cal.findFreeSlots(input);
          return { ok: true as const, result: { slots } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
  ],
  skills: [],
});
