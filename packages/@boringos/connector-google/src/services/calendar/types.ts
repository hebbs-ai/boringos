// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; responseStatus?: string; displayName?: string }[];
  location?: string;
  status?: string;
  htmlLink?: string;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}
