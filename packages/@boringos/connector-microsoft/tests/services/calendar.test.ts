// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from "vitest";
import { CalendarClient } from "../../src/services/calendar/client.js";

describe("CalendarClient", () => {
  it("lists events from the value array", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          value: [
            {
              id: "e1",
              start: { dateTime: "2026-01-01T10:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2026-01-01T11:00:00.0000000", timeZone: "UTC" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    const events = await client.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("e1");
  });

  it("uses calendarView when a time window is provided", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    await client.listEvents({ timeMin: "2026-01-01T00:00:00Z", timeMax: "2026-01-02T00:00:00Z" });
    expect(capturedUrl).toContain("/calendarView");
    expect(capturedUrl).toContain("startDateTime=");
    expect(capturedUrl).toContain("endDateTime=");
  });

  it("computes free slots between busy events (UTC normalized)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          value: [
            {
              id: "e1",
              start: { dateTime: "2026-01-01T10:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2026-01-01T11:00:00.0000000", timeZone: "UTC" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    const free = await client.findFreeSlots({
      timeMin: "2026-01-01T09:00:00Z",
      timeMax: "2026-01-01T12:00:00Z",
      durationMinutes: 30,
    });
    // 09:00-10:00 free, then 11:00-12:00 free.
    expect(free).toEqual([
      { start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T10:00:00.000Z" },
      { start: "2026-01-01T11:00:00.000Z", end: "2026-01-01T12:00:00.000Z" },
    ]);
  });

  it("createEvent posts and returns the created event", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ id: "new1", subject: "Sync" }), { status: 201 });
    });
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    const created = await client.createEvent({ subject: "Sync" });
    expect(created.id).toBe("new1");
  });

  it("deleteEvent ignores 404 (already deleted)", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.deleteEvent("e1")).resolves.toBeUndefined();
  });

  it("deleteEvent throws on other errors", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.deleteEvent("e1")).rejects.toThrow("Calendar deleteEvent failed: 500");
  });
});
