// SPDX-License-Identifier: BUSL-1.1
//
// Schedule-from-inbox modal. Pre-fills attendees + title from the
// inbox item, calls google.find_free_slots, lets the user pick a
// 30-min slot, then creates the event AND auto-replies to the
// original email with the confirmed time. Stamps
// `metadata.scheduledMeeting` on the inbox item so the row + detail
// can show "🗓 Meeting scheduled" the next time it's opened.

import { useEffect, useMemo, useState } from "react";
import type { InboxItem } from "@boringos/ui";
import { useClient } from "@boringos/ui";

export interface ScheduleMeetingModalProps {
  item: InboxItem;
  onClose: () => void;
  /** Fired after a successful schedule so the parent can refresh. */
  onScheduled?: () => void;
}

interface Slot {
  start: string; // ISO
  end: string; // ISO
}

const DURATION_MINUTES = 30;
const WINDOW_DAYS = 7;

/** Pull "Name <email>" → email; passthrough plain emails. */
function extractEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /<([^>]+)>/.exec(raw);
  if (match && match[1]) return match[1].trim();
  const trimmed = raw.trim();
  return trimmed.includes("@") ? trimmed : null;
}

/** Title derivation — use the email subject, drop "Re:" / "Fwd:" prefixes. */
function deriveTitle(subject: string | null | undefined): string {
  const cleaned = (subject ?? "")
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, "")
    .trim();
  return cleaned ? `Meeting: ${cleaned.slice(0, 60)}` : "Meeting";
}

function formatSlot(start: string, end: string): { day: string; time: string } {
  const s = new Date(start);
  const e = new Date(end);
  return {
    day: s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    time: `${s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${e.toLocaleTimeString(
      undefined,
      { hour: "numeric", minute: "2-digit" },
    )}`,
  };
}

function groupSlotsByDay(slots: Slot[]): Array<{ day: string; slots: Slot[] }> {
  const buckets = new Map<string, { day: string; slots: Slot[] }>();
  for (const s of slots) {
    const key = new Date(s.start).toDateString();
    const day = new Date(s.start).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (!buckets.has(key)) buckets.set(key, { day, slots: [] });
    buckets.get(key)!.slots.push(s);
  }
  return Array.from(buckets.values());
}

export function ScheduleMeetingModal({ item, onClose, onScheduled }: ScheduleMeetingModalProps) {
  const client = useClient();

  const senderEmail = useMemo(() => extractEmail(item.from), [item.from]);
  const [title, setTitle] = useState(deriveTitle(item.subject));
  const [attendees, setAttendees] = useState(senderEmail ?? "");
  const [picked, setPicked] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  // Fetch free slots once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const result = await client.invokeAction("google", "calendar.find_free_slots", {
          timeMin: now.toISOString(),
          timeMax: end.toISOString(),
          durationMinutes: DURATION_MINUTES,
          maxSlots: 12,
          timeZone,
        });
        if (cancelled) return;
        if (!result.success) throw new Error(result.error ?? "find_free_slots failed");
        setSlots(((result.data as { slots?: Slot[] })?.slots ?? []) as Slot[]);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, timeZone]);

  const onConfirm = async () => {
    if (!picked) return;
    setError(null);
    setBusy(true);
    try {
      const attendeeList = attendees
        .split(/[\s,]+/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.includes("@"));

      // 1) Create the event.
      const create = await client.invokeAction("google", "calendar.create_event", {
        summary: title,
        startTime: picked.start,
        endTime: picked.end,
        timeZone,
        attendees: attendeeList.length > 0 ? attendeeList : undefined,
      });
      if (!create.success) throw new Error(create.error ?? "Couldn't create event");
      const eventId = (create.data as { id?: string } | undefined)?.id;
      const htmlLink = (create.data as { htmlLink?: string } | undefined)?.htmlLink;

      // 2) Auto-reply with the confirmed slot, only when the email is
      // actually from Gmail (we have somewhere to send to).
      if (item.source === "google.gmail" && senderEmail) {
        const fmt = formatSlot(picked.start, picked.end);
        const subject = item.subject?.toLowerCase().startsWith("re:")
          ? item.subject
          : `Re: ${item.subject ?? "(no subject)"}`;
        const body = [
          `Booked us in for ${fmt.day}, ${fmt.time}.`,
          "",
          htmlLink ? `Calendar event: ${htmlLink}` : "",
          "",
          "Looking forward to it.",
        ]
          .filter(Boolean)
          .join("\n");
        await client.invokeAction("google", "gmail.send_email", {
          to: senderEmail,
          subject,
          body,
        });
      }

      // 3) Stamp metadata.scheduledMeeting on the inbox item so the UI
      // can surface "🗓 Meeting scheduled" without re-deriving it.
      const existing = (item.metadata as Record<string, unknown> | undefined) ?? {};
      await client.updateInboxItem(item.id, {
        metadata: {
          ...existing,
          scheduledMeeting: {
            eventId,
            htmlLink,
            startsAt: picked.start,
            endsAt: picked.end,
            scheduledAt: new Date().toISOString(),
          },
        },
      });

      setDone(true);
      onScheduled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="schedule-meeting-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-white shadow-xl ring-1 ring-slate-200 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {done ? "Meeting scheduled." : "Schedule a meeting"}
          </h2>
          {!done && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              Pick a {DURATION_MINUTES}-minute slot in the next {WINDOW_DAYS} days. We'll
              create the event and {item.source === "google.gmail" && senderEmail
                ? "send a confirmation reply."
                : "stamp it on the inbox item."}
            </p>
          )}
        </header>

        <div className="px-5 py-4 space-y-3 overflow-auto">
          {done ? (
            <div className="rounded-md bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 text-sm text-emerald-800">
              Event created and confirmation sent.
            </div>
          ) : (
            <>
              <Field label="Title">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Attendees (comma or whitespace separated)">
                <input
                  type="text"
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="alice@example.com, bob@example.com"
                  disabled={busy}
                  className={INPUT_CLASS}
                />
              </Field>

              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                  Available slots
                </span>
                <div className="mt-1.5">
                  {loadingSlots ? (
                    <p className="text-xs text-slate-400">Checking your calendar…</p>
                  ) : slots.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No {DURATION_MINUTES}-minute slots available in the next {WINDOW_DAYS}{" "}
                      days within your working hours. Try a custom time via the New
                      Event button on Calendar.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {groupSlotsByDay(slots).map((group) => (
                        <div key={group.day}>
                          <div className="text-[11px] font-medium text-slate-600 mb-1">
                            {group.day}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.slots.map((s) => {
                              const fmt = formatSlot(s.start, s.end);
                              const isPicked = picked?.start === s.start;
                              return (
                                <button
                                  key={s.start}
                                  type="button"
                                  onClick={() => setPicked(s)}
                                  disabled={busy}
                                  className={`text-xs font-medium px-2.5 py-1.5 rounded-md ring-1 ${
                                    isPicked
                                      ? "bg-blue-600 text-white ring-blue-600"
                                      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  {fmt.time.split(" – ")[0]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          {done ? (
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              Close
            </button>
          ) : (
            <>
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
                onClick={() => void onConfirm()}
                disabled={busy || !picked || !title.trim()}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
              >
                {busy ? "Scheduling…" : picked ? "Schedule + send confirm" : "Pick a slot"}
              </button>
            </>
          )}
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
