// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed CalendarClient. Wraps the Microsoft Graph v1.0 calendar surface
// (/me/events, /me/calendarView). Mirrors the Google CalendarClient method
// shape (listEvents, getEvent, createEvent, updateEvent, deleteEvent,
// findFreeSlots).
//
// findFreeSlots derives availability from the events in the window rather
// than Graph's getSchedule API, which would require the account's own email
// address as a parameter. Computing from calendarView keeps the client
// self-contained and identity-free.

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { CalendarEvent, FreeBusySlot } from "./types.js";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

// Graph returns calendarView dateTimes in UTC with no trailing "Z". Append it
// so `new Date()` parses them as UTC rather than local time.
function graphDateToMs(dateTime: string, timeZone?: string): number {
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(dateTime);
  if (hasZone) return new Date(dateTime).getTime();
  if (!timeZone || timeZone.toUpperCase() === "UTC") return new Date(`${dateTime}Z`).getTime();
  return new Date(dateTime).getTime();
}

export class CalendarClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listEvents(opts?: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  }): Promise<CalendarEvent[]> {
    const params = new URLSearchParams();
    if (opts?.maxResults) params.set("$top", String(opts.maxResults));
    let base: string;
    if (opts?.timeMin && opts?.timeMax) {
      params.set("startDateTime", opts.timeMin);
      params.set("endDateTime", opts.timeMax);
      params.set("$orderby", "start/dateTime");
      base = `${GRAPH_API}/calendarView`;
    } else {
      params.set("$orderby", "start/dateTime");
      base = `${GRAPH_API}/events`;
    }
    const url = `${base}?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "GET",
      // Ask Graph to return event times in UTC.
      headers: { Prefer: 'outlook.timezone="UTC"' },
    });
    if (!res.ok) throw new Error(`Calendar listEvents failed: ${res.status}`);
    const body = (await res.json()) as { value?: CalendarEvent[] };
    return body.value ?? [];
  }

  async getEvent(eventId: string): Promise<CalendarEvent> {
    const url = `${GRAPH_API}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Calendar getEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async createEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const url = `${GRAPH_API}/events`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`Calendar createEvent failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as CalendarEvent;
  }

  async updateEvent(eventId: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const url = `${GRAPH_API}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Calendar updateEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async deleteEvent(eventId: string): Promise<void> {
    const url = `${GRAPH_API}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "DELETE" });
    // 404 => already gone; treat as success (parallels Google's 410 handling).
    if (!res.ok && res.status !== 404) throw new Error(`Calendar deleteEvent failed: ${res.status}`);
  }

  async findFreeSlots(opts: {
    timeMin: string;
    timeMax: string;
    durationMinutes: number;
  }): Promise<FreeBusySlot[]> {
    const events = await this.listEvents({ timeMin: opts.timeMin, timeMax: opts.timeMax });
    const busy: FreeBusySlot[] = events
      .filter((e) => !e.isCancelled && e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        start: new Date(graphDateToMs(e.start.dateTime, e.start.timeZone)).toISOString(),
        end: new Date(graphDateToMs(e.end.dateTime, e.end.timeZone)).toISOString(),
      }));
    return computeFreeSlots(opts.timeMin, opts.timeMax, opts.durationMinutes, busy);
  }
}

function computeFreeSlots(
  timeMin: string,
  timeMax: string,
  durationMinutes: number,
  busy: FreeBusySlot[],
): FreeBusySlot[] {
  const minMs = new Date(timeMin).getTime();
  const maxMs = new Date(timeMax).getTime();
  const durMs = durationMinutes * 60 * 1000;
  const sorted = [...busy].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const free: FreeBusySlot[] = [];
  let cursor = minMs;
  for (const slot of sorted) {
    const s = new Date(slot.start).getTime();
    if (s - cursor >= durMs) {
      free.push({ start: new Date(cursor).toISOString(), end: new Date(s).toISOString() });
    }
    cursor = Math.max(cursor, new Date(slot.end).getTime());
  }
  if (maxMs - cursor >= durMs) {
    free.push({ start: new Date(cursor).toISOString(), end: new Date(maxMs).toISOString() });
  }
  return free;
}
