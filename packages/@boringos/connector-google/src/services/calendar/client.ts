// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { CalendarEvent, FreeBusySlot } from "./types.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export class CalendarClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listEvents(opts?: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  }): Promise<CalendarEvent[]> {
    const cal = opts?.calendarId ?? "primary";
    const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime" });
    if (opts?.timeMin) params.set("timeMin", opts.timeMin);
    if (opts?.timeMax) params.set("timeMax", opts.timeMax);
    if (opts?.maxResults) params.set("maxResults", String(opts.maxResults));
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Calendar listEvents failed: ${res.status}`);
    const body = (await res.json()) as { items?: CalendarEvent[] };
    return body.items ?? [];
  }

  async getEvent(eventId: string, opts?: { calendarId?: string }): Promise<CalendarEvent> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Calendar getEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async createEvent(event: Partial<CalendarEvent>, opts?: { calendarId?: string }): Promise<CalendarEvent> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`Calendar createEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async updateEvent(
    eventId: string,
    patch: Partial<CalendarEvent>,
    opts?: { calendarId?: string },
  ): Promise<CalendarEvent> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Calendar updateEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async deleteEvent(eventId: string, opts?: { calendarId?: string }): Promise<void> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "DELETE" });
    if (!res.ok && res.status !== 410) throw new Error(`Calendar deleteEvent failed: ${res.status}`);
  }

  async findFreeSlots(opts: {
    timeMin: string;
    timeMax: string;
    durationMinutes: number;
    calendarId?: string;
  }): Promise<FreeBusySlot[]> {
    const cal = opts.calendarId ?? "primary";
    const url = `${CALENDAR_API}/freeBusy`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: opts.timeMin, timeMax: opts.timeMax, items: [{ id: cal }] }),
    });
    if (!res.ok) throw new Error(`Calendar freeBusy failed: ${res.status}`);
    const body = (await res.json()) as { calendars: Record<string, { busy: FreeBusySlot[] }> };
    const busy = body.calendars[cal]?.busy ?? [];
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
