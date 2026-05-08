// SPDX-License-Identifier: BUSL-1.1
//
// Calendar screen — week + agenda views over the connected Google
// calendar. Reads live from Google on every open (no DB cache for
// v1; reverse-sync ticker is deferred per task_03).
//
// Layout: tabbed switcher across [Week, Agenda] on the left pane,
// shared detail pane on the right. Cron / Notion Calendar / Fantastical
// all default to a 7-day grid; Agenda is the secondary "list of
// upcoming" affordance.

import { useEffect, useMemo, useState } from "react";
import { useClient } from "@boringos/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ScreenHeader, ScreenBody, EmptyState, LoadingState } from "./_shared.js";

interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email?: string; displayName?: string };
  status?: string;
}

type View = "week" | "agenda";
const RANGE_DAYS = 14;

// ── shared time helpers ─────────────────────────────────────────────

function rangeIso() {
  const now = new Date();
  const end = new Date(now.getTime() + RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { timeMin: now.toISOString(), timeMax: end.toISOString() };
}

function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function startOf(e: CalEvent): Date | null {
  const v = e.start?.dateTime ?? e.start?.date;
  return v ? new Date(v) : null;
}

function endOf(e: CalEvent): Date | null {
  const v = e.end?.dateTime ?? e.end?.date;
  return v ? new Date(v) : null;
}

function isAllDay(e: CalEvent): boolean {
  return !!e.start?.date && !e.start?.dateTime;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ── top-level screen ────────────────────────────────────────────────

export function Calendar() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [view, setView] = useState<View>("week");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["calendar", "list_events", "primary"],
    queryFn: async () => {
      const { timeMin, timeMax } = rangeIso();
      const result = await client.invokeAction("google", "calendar.list_events", {
        timeMin,
        timeMax,
        maxResults: 100,
      });
      if (!result.success) throw new Error(result.error ?? "Failed to load events");
      return ((result.data as { events?: CalEvent[] })?.events ?? []) as CalEvent[];
    },
  });

  const events = data ?? [];
  const selected = events.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && events.length > 0) setSelectedId(events[0]!.id);
  }, [events, selectedId]);

  const onCreated = async () => {
    setComposeOpen(false);
    await queryClient.invalidateQueries({ queryKey: ["calendar"] });
  };

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Calendar"
        subtitle={view === "week" ? "This week and next" : `Next ${RANGE_DAYS} days`}
        actions={
          <>
            <ViewTabs view={view} onChange={setView} />
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              + New event
            </button>
          </>
        }
      />

      {error ? (
        <ScreenBody>
          <EmptyState
            title="Couldn't load calendar"
            description={
              error instanceof Error
                ? `${error.message}. Connect Google from Connectors if you haven't yet.`
                : "Something went wrong fetching events."
            }
          />
        </ScreenBody>
      ) : isLoading ? (
        <LoadingState />
      ) : events.length === 0 ? (
        <ScreenBody>
          <EmptyState
            title="Nothing on the calendar"
            description={`No events in the next ${RANGE_DAYS} days. Create one to get started.`}
          />
        </ScreenBody>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {view === "week" ? (
            <WeekView
              events={events}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <AgendaList
              events={events}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}

          <div className="flex-1 overflow-auto border-l border-slate-100">
            {selected ? (
              <EventDetail event={selected} />
            ) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <p className="text-sm text-slate-500">Select an event to read.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {composeOpen && (
        <NewEventModal onClose={() => setComposeOpen(false)} onCreated={onCreated} />
      )}
    </div>
  );
}

// ── tabs ────────────────────────────────────────────────────────────

function ViewTabs({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-md bg-slate-100 p-0.5">
      {(["week", "agenda"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`text-xs font-medium px-3 py-1 rounded ${
            view === v
              ? "bg-white shadow-sm text-slate-900"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {v === "week" ? "Week" : "Agenda"}
        </button>
      ))}
    </div>
  );
}

// ── agenda view (the original list) ─────────────────────────────────

function AgendaList({
  events,
  selectedId,
  onSelect,
}: {
  events: CalEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const buckets = new Map<string, { day: string; date: Date; events: CalEvent[] }>();
    for (const e of events) {
      const s = startOf(e);
      if (!s) continue;
      const key = s.toDateString();
      if (!buckets.has(key)) buckets.set(key, { day: formatDay(s), date: s, events: [] });
      buckets.get(key)!.events.push(e);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events]);

  return (
    <ul className="w-96 overflow-auto">
      {grouped.map((g) => (
        <li key={g.day}>
          <div className="sticky top-0 bg-slate-50 px-4 py-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide border-b border-slate-100">
            {g.day}
          </div>
          <ul className="divide-y divide-slate-100">
            {g.events.map((e) => {
              const s = startOf(e);
              const en = endOf(e);
              const isSel = e.id === selectedId;
              return (
                <li
                  key={e.id}
                  onClick={() => onSelect(e.id)}
                  className={`px-4 py-3 cursor-pointer border-l-2 ${
                    isSel
                      ? "bg-blue-50/60 border-blue-500"
                      : "border-transparent hover:bg-slate-50"
                  }`}
                >
                  <div className="text-[10px] text-slate-500 tabular-nums">
                    {isAllDay(e)
                      ? "All day"
                      : s && en
                        ? `${formatTime(s)} – ${formatTime(en)}`
                        : "—"}
                  </div>
                  <div className="text-sm font-medium text-slate-900 truncate mt-0.5">
                    {e.summary || "(untitled event)"}
                  </div>
                  {e.attendees && e.attendees.length > 0 && (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {e.attendees.length} attendee{e.attendees.length === 1 ? "" : "s"}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// ── week view ───────────────────────────────────────────────────────

const HOUR_START = 7; // 7 AM
const HOUR_END = 22; // 10 PM (exclusive — last hour shown is 9 PM)
const HOUR_HEIGHT = 48; // px per hour
const ALL_DAY_ROW_HEIGHT = 32; // px

function WeekView({
  events,
  selectedId,
  onSelect,
}: {
  events: CalEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // 7-day window starting from today.
  const days = useMemo(() => {
    const start = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, []);

  // Bucket events per day. Multi-day events surface in each day they
  // intersect (clipped to the day's hour band).
  const eventsByDay = useMemo(() => {
    const map = days.map(() => [] as CalEvent[]);
    for (const e of events) {
      const s = startOf(e);
      const en = endOf(e);
      if (!s) continue;
      for (let i = 0; i < days.length; i++) {
        const day = days[i]!;
        const dayEnd = addDays(day, 1);
        const intersects = en
          ? s.getTime() < dayEnd.getTime() && en.getTime() > day.getTime()
          : sameDay(s, day);
        if (intersects) map[i]!.push(e);
      }
    }
    return map;
  }, [events, days]);

  // Now-line (red horizontal line at the current hour, only on today's column).
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const todayIdx = days.findIndex((d) => sameDay(d, now));

  // Auto-scroll to the current hour on first render so the user lands
  // looking at "right now" instead of 7 AM.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scroller) return;
    const offsetHour = Math.max(now.getHours() - 1, HOUR_START);
    scroller.scrollTop = (offsetHour - HOUR_START) * HOUR_HEIGHT;
  }, [scroller]); // run once when the scroller mounts

  return (
    <div className="flex-1 overflow-hidden flex flex-col min-w-0">
      {/* Day-headers row (sticky on top) */}
      <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
        <div /> {/* gutter for hour labels */}
        {days.map((d, i) => {
          const isToday = sameDay(d, now);
          return (
            <div
              key={i}
              className="px-2 py-2 text-center border-l border-slate-100"
            >
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div
                className={`text-sm font-semibold mt-0.5 ${
                  isToday ? "text-blue-600" : "text-slate-900"
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day strip */}
      <div className="grid border-b border-slate-100 bg-slate-50/50" style={{ gridTemplateColumns: "60px repeat(7, 1fr)", minHeight: ALL_DAY_ROW_HEIGHT }}>
        <div className="text-[10px] text-slate-400 px-2 py-1.5 self-start">All-day</div>
        {days.map((d, i) => {
          const allDay = (eventsByDay[i] ?? []).filter(isAllDay);
          return (
            <div key={i} className="px-1 py-1 border-l border-slate-100 space-y-0.5">
              {allDay.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e.id)}
                  className={`w-full text-left text-[10px] truncate px-1.5 py-0.5 rounded ${
                    e.id === selectedId
                      ? "bg-blue-600 text-white"
                      : "bg-blue-100 text-blue-900 hover:bg-blue-200"
                  }`}
                  title={e.summary}
                >
                  {e.summary || "(untitled)"}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Scrollable hour grid */}
      <div ref={setScroller} className="flex-1 overflow-auto relative">
        <div className="grid relative" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
          {/* Hour labels column */}
          <div className="relative">
            {Array.from({ length: HOUR_END - HOUR_START }).map((_, i) => (
              <div
                key={i}
                className="text-[10px] text-slate-400 text-right pr-2 border-b border-slate-50"
                style={{ height: HOUR_HEIGHT, lineHeight: "1" }}
              >
                <span className="relative -top-1.5 bg-white px-0.5">
                  {formatHour(HOUR_START + i)}
                </span>
              </div>
            ))}
          </div>

          {/* 7 day columns */}
          {days.map((day, i) => {
            const timed = (eventsByDay[i] ?? []).filter((e) => !isAllDay(e));
            const isToday = sameDay(day, now);
            return (
              <div
                key={i}
                className="relative border-l border-slate-100"
                style={{ height: (HOUR_END - HOUR_START) * HOUR_HEIGHT }}
              >
                {/* Hourly grid lines */}
                {Array.from({ length: HOUR_END - HOUR_START }).map((_, h) => (
                  <div
                    key={h}
                    className="border-b border-slate-50"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}

                {/* Now-line (today only) */}
                {isToday && i === todayIdx && (
                  <div
                    className="absolute left-0 right-0 z-10"
                    style={{ top: nowOffsetPx(now) }}
                  >
                    <div className="h-px bg-rose-500" />
                  </div>
                )}

                {/* Event blocks */}
                {timed.map((e) => {
                  const layout = layoutEventForDay(e, day);
                  if (!layout) return null;
                  const isSel = e.id === selectedId;
                  const en = endOf(e);
                  const s = startOf(e);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onSelect(e.id)}
                      className={`absolute left-1 right-1 rounded px-1.5 py-1 text-left overflow-hidden ${
                        isSel
                          ? "bg-blue-600 text-white ring-2 ring-blue-700 z-20"
                          : "bg-blue-100 text-blue-900 hover:bg-blue-200 z-10"
                      }`}
                      style={{ top: layout.top, height: layout.height }}
                      title={e.summary}
                    >
                      <div className="text-[10px] font-semibold leading-tight truncate">
                        {e.summary || "(untitled)"}
                      </div>
                      {layout.height >= 32 && s && en && (
                        <div className={`text-[9px] truncate ${isSel ? "text-blue-100" : "text-blue-700"}`}>
                          {formatTime(s)} – {formatTime(en)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatHour(hour24: number): string {
  const ampm = hour24 < 12 ? "AM" : "PM";
  const h = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  return `${h} ${ampm}`;
}

function nowOffsetPx(now: Date): number {
  const minutesSinceStart = (now.getHours() - HOUR_START) * 60 + now.getMinutes();
  return Math.max(0, (minutesSinceStart / 60) * HOUR_HEIGHT);
}

/**
 * Compute (top, height) in pixels for an event positioned within a
 * given day's hour band [HOUR_START, HOUR_END). Multi-day events get
 * clipped to the day's band.
 */
function layoutEventForDay(
  e: CalEvent,
  day: Date,
): { top: number; height: number } | null {
  const s = startOf(e);
  const en = endOf(e);
  if (!s || !en) return null;

  const dayStart = day;
  const dayEnd = addDays(day, 1);
  const visibleStart = new Date(Math.max(s.getTime(), dayStart.getTime()));
  const visibleEnd = new Date(Math.min(en.getTime(), dayEnd.getTime()));

  const startMinutes =
    (visibleStart.getHours() - HOUR_START) * 60 + visibleStart.getMinutes();
  const endMinutes =
    (visibleEnd.getHours() - HOUR_START) * 60 + visibleEnd.getMinutes();

  // Clip to the visible hour band; if the whole event falls outside
  // [HOUR_START, HOUR_END), don't render it.
  const bandEnd = (HOUR_END - HOUR_START) * 60;
  const clippedStart = Math.max(0, startMinutes);
  const clippedEnd = Math.min(bandEnd, endMinutes);
  if (clippedEnd <= clippedStart) return null;

  return {
    top: (clippedStart / 60) * HOUR_HEIGHT,
    height: Math.max(18, ((clippedEnd - clippedStart) / 60) * HOUR_HEIGHT),
  };
}

// ── detail pane ─────────────────────────────────────────────────────

function EventDetail({ event }: { event: CalEvent }) {
  const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;

  return (
    <div className="px-6 py-5">
      <h2 className="text-lg font-semibold text-slate-900 leading-tight">
        {event.summary || "(untitled event)"}
      </h2>
      <div className="mt-2 text-xs text-slate-500 space-x-2">
        {isAllDay(event) ? (
          <span>All day, {formatDay(new Date(event.start!.date!))}</span>
        ) : start && end ? (
          <span>
            {formatDay(start)}, {formatTime(start)} – {formatTime(end)}
          </span>
        ) : null}
        {event.location && (
          <>
            <span>·</span>
            <span>{event.location}</span>
          </>
        )}
      </div>

      {event.hangoutLink && (
        <a
          href={event.hangoutLink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
        >
          Join Meet
        </a>
      )}

      {event.description && (
        <section className="mt-5">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            Description
          </h3>
          <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
            {event.description}
          </p>
        </section>
      )}

      {event.attendees && event.attendees.length > 0 && (
        <section className="mt-5">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            Attendees ({event.attendees.length})
          </h3>
          <ul className="mt-1.5 space-y-1">
            {event.attendees.map((a) => (
              <li key={a.email} className="flex items-center gap-2 text-sm text-slate-800">
                <span className="text-slate-400">•</span>
                <span>{a.displayName || a.email}</span>
                {a.responseStatus && a.responseStatus !== "needsAction" && (
                  <span className="text-[10px] text-slate-500">
                    {a.responseStatus}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.htmlLink && (
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-block text-xs text-slate-500 hover:text-slate-900 underline"
        >
          Open in Google Calendar →
        </a>
      )}
    </div>
  );
}

// ── new event modal ─────────────────────────────────────────────────

interface NewEventModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewEventModal({ onClose, onCreated }: NewEventModalProps) {
  const client = useClient();
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  }, []);
  const tomorrowEnd = useMemo(() => new Date(tomorrow.getTime() + 30 * 60_000), [tomorrow]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startStr, setStartStr] = useState(toDateTimeLocal(tomorrow));
  const [endStr, setEndStr] = useState(toDateTimeLocal(tomorrowEnd));
  const [attendeesStr, setAttendeesStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const attendees = attendeesStr
        .split(/[\s,]+/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.includes("@"));
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const result = await client.invokeAction("google", "calendar.create_event", {
        summary: title.trim(),
        description: description.trim() || undefined,
        startTime: new Date(startStr).toISOString(),
        endTime: new Date(endStr).toISOString(),
        timeZone: tz,
        attendees: attendees.length > 0 ? attendees : undefined,
      });
      if (!result.success) throw new Error(result.error ?? "Create failed");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl ring-1 ring-slate-200 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">New event</h2>
        </header>

        <div className="px-5 py-4 space-y-3 overflow-auto">
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              className={INPUT_CLASS}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                disabled={busy}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="End">
              <input
                type="datetime-local"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                disabled={busy}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <Field label="Attendees (comma or whitespace separated)">
            <input
              type="text"
              value={attendeesStr}
              onChange={(e) => setAttendeesStr(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
              disabled={busy}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={busy}
              className={`${INPUT_CLASS} font-sans`}
            />
          </Field>
          {error && (
            <div className="rounded-md bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !title.trim() || !startStr || !endStr}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const INPUT_CLASS =
  "mt-1 w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
