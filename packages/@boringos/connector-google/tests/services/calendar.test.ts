// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from "vitest";
import { CalendarClient } from "../../src/services/calendar/client.js";

describe("CalendarClient (v2 typed)", () => {
  it("lists events", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: "e1",
              start: { dateTime: "2026-01-01T10:00:00Z" },
              end: { dateTime: "2026-01-01T11:00:00Z" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    const events = await client.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("e1");
  });

  it("computes free slots between busy blocks", async () => {
    const busy = [{ start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" }];
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ calendars: { primary: { busy } } }),
        { status: 200 },
      ),
    );
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    const free = await client.findFreeSlots({
      timeMin: "2026-01-01T09:00:00Z",
      timeMax: "2026-01-01T12:00:00Z",
      durationMinutes: 30,
    });
    expect(free.length).toBeGreaterThanOrEqual(1);
  });

  it("deleteEvent ignores 410 (already deleted)", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 410 }));
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.deleteEvent("e1")).resolves.toBeUndefined();
  });
});
