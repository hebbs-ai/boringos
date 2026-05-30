// SPDX-License-Identifier: AGPL-3.0-or-later

export interface DateTimeTimeZone {
  dateTime: string;
  timeZone?: string;
}

export interface Attendee {
  emailAddress: { address: string; name?: string };
  type?: "required" | "optional" | "resource";
  status?: { response?: string; time?: string };
}

// A Microsoft Graph event resource (subset of fields the client surfaces).
// https://learn.microsoft.com/graph/api/resources/event
export interface CalendarEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: "text" | "html"; content: string };
  start: DateTimeTimeZone;
  end: DateTimeTimeZone;
  location?: { displayName?: string };
  attendees?: Attendee[];
  organizer?: { emailAddress: { address: string; name?: string } };
  isAllDay?: boolean;
  isCancelled?: boolean;
  webLink?: string;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}
