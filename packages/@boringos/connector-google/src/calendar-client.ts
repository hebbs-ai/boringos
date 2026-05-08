import type { ActionResult } from "./gmail-client.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export class CalendarClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case "list_events": return this.listEvents(inputs.timeMin as string | undefined, inputs.timeMax as string | undefined, inputs.maxResults as number | undefined);
      case "create_event": return this.createEvent(inputs as Record<string, unknown>);
      case "update_event": return this.updateEvent(inputs.eventId as string, inputs as Record<string, unknown>);
      case "delete_event": return this.deleteEvent(inputs.eventId as string);
      case "find_free_slots": return this.findFreeSlots(inputs as Record<string, unknown>);
      default: return { success: false, error: `Unknown Calendar action: ${action}` };
    }
  }

  private async listEvents(timeMin?: string, timeMax?: string, maxResults?: number): Promise<ActionResult> {
    // Default to today if no time range specified
    const effectiveTimeMin = timeMin ?? new Date().toISOString();
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(maxResults ?? 10),
      timeMin: effectiveTimeMin,
    });
    if (timeMax) params.set("timeMax", timeMax);

    const res = await this.api(`${CALENDAR_API}/calendars/primary/events?${params}`);
    if (!res.ok) return { success: false, error: `Calendar API error: ${res.status}` };

    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { events: data.items ?? [] } };
  }

  private async createEvent(inputs: Record<string, unknown>): Promise<ActionResult> {
    const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        summary: inputs.summary,
        description: inputs.description,
        start: { dateTime: inputs.startTime, timeZone: inputs.timeZone ?? "UTC" },
        end: { dateTime: inputs.endTime, timeZone: inputs.timeZone ?? "UTC" },
        attendees: inputs.attendees ? (inputs.attendees as string[]).map((e) => ({ email: e })) : undefined,
      }),
    });

    if (!res.ok) return { success: false, error: `Calendar create failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id, htmlLink: data.htmlLink } };
  }

  private async updateEvent(eventId: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    const body: Record<string, unknown> = {};
    if (inputs.summary) body.summary = inputs.summary;
    if (inputs.description) body.description = inputs.description;
    if (inputs.startTime) body.start = { dateTime: inputs.startTime, timeZone: inputs.timeZone ?? "UTC" };
    if (inputs.endTime) body.end = { dateTime: inputs.endTime, timeZone: inputs.timeZone ?? "UTC" };

    const res = await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return { success: false, error: `Calendar update failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id } };
  }

  /**
   * Find available, fixed-length meeting slots inside a window —
   * tuned for a slot-picker UI, not for "any free time."
   *
   * Walks the window in `slotIntervalMinutes` steps; each candidate
   * slot of `durationMinutes` is kept if it fits inside working hours
   * AND doesn't intersect any busy block from the freebusy API.
   *
   * Inputs (all but timeMin/timeMax optional):
   *   timeMin, timeMax (ISO)              — window
   *   durationMinutes                     — slot length (default 30)
   *   workingHourStart / workingHourEnd   — local hours (default 9–17)
   *   workingDaysMask                     — bitmask Sun..Sat (default Mon–Fri = 0b0111110)
   *   slotIntervalMinutes                 — step granularity (default 30)
   *   maxSlots                            — cap returned (default 12)
   *   timeZone                            — IANA tz the window applies in (default UTC)
   */
  private async findFreeSlots(inputs: Record<string, unknown>): Promise<ActionResult> {
    const timeMin = inputs.timeMin as string;
    const timeMax = inputs.timeMax as string;
    if (!timeMin || !timeMax) {
      return { success: false, error: "timeMin and timeMax are required" };
    }
    const durationMinutes = (inputs.durationMinutes as number) ?? 30;
    const workingHourStart = (inputs.workingHourStart as number) ?? 9;
    const workingHourEnd = (inputs.workingHourEnd as number) ?? 17;
    const workingDaysMask = (inputs.workingDaysMask as number) ?? 0b0111110;
    const slotIntervalMinutes = (inputs.slotIntervalMinutes as number) ?? 30;
    const maxSlots = (inputs.maxSlots as number) ?? 12;
    const timeZone = (inputs.timeZone as string) ?? "UTC";

    const fbRes = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ timeMin, timeMax, timeZone, items: [{ id: "primary" }] }),
    });
    if (!fbRes.ok) return { success: false, error: `Calendar freebusy failed: ${fbRes.status}` };

    const fbData = (await fbRes.json()) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };
    const busy = (fbData.calendars?.primary?.busy ?? []).map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));

    const slots: Array<{ start: string; end: string }> = [];
    const stepMs = slotIntervalMinutes * 60_000;
    const durationMs = durationMinutes * 60_000;
    const windowEnd = new Date(timeMax).getTime();
    let cursor = Math.ceil(new Date(timeMin).getTime() / stepMs) * stepMs;

    function localPartsOf(ms: number): { day: number; hour: number; minute: number } {
      // Project a UTC instant into the supplied tz via toLocaleString,
      // then re-parse — avoids a tz library dependency.
      const local = new Date(new Date(ms).toLocaleString("en-US", { timeZone }));
      return { day: local.getDay(), hour: local.getHours(), minute: local.getMinutes() };
    }

    while (cursor + durationMs <= windowEnd && slots.length < maxSlots) {
      const slotEnd = cursor + durationMs;
      const startParts = localPartsOf(cursor);
      const endParts = localPartsOf(slotEnd);

      const dayAllowed = ((workingDaysMask >> startParts.day) & 1) === 1;
      const hourAllowed = startParts.hour >= workingHourStart && startParts.hour < workingHourEnd;
      const fitsBeforeClose =
        endParts.hour < workingHourEnd ||
        (endParts.hour === workingHourEnd && endParts.minute === 0);
      const sameDay = endParts.day === startParts.day;
      const conflicts = busy.some((b) => cursor < b.end && slotEnd > b.start);

      if (dayAllowed && hourAllowed && fitsBeforeClose && sameDay && !conflicts) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(slotEnd).toISOString(),
        });
      }
      cursor += stepMs;
    }

    return { success: true, data: { slots } };
  }

  private async deleteEvent(eventId: string): Promise<ActionResult> {
    if (!eventId) return { success: false, error: "eventId is required" };
    const res = await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) return { success: false, error: `Calendar delete failed: ${res.status}` };
    return { success: true, data: { id: eventId } };
  }

  private api(url: string): Promise<Response> {
    return fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
}
