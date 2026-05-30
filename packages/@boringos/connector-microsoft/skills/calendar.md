# Outlook Calendar (via Microsoft 365 connector)

You can list, create, update, and find free time on the user's calendar. Tool names: `calendar.list_events`, `calendar.create_event`, `calendar.update_event`, `calendar.find_free_slots`.

## Tools

### calendar.list_events
List upcoming events. When both `timeMin` and `timeMax` are given, Graph's calendarView is used (expands recurring events into instances).
- `timeMin` / `timeMax`: ISO 8601 strings
- `maxResults`: defaults to 10

### calendar.create_event
Create a new calendar event. Required: `summary`, `startTime`, `endTime`. Optional: `description`, `location`, `attendees`, `timeZone` (default UTC).
Always include a timezone.

### calendar.update_event
Modify an existing event by its `eventId`. Only include fields you want to change.

### calendar.find_free_slots
Find available time slots. Specify `timeMin`, `timeMax`, and required `durationMinutes`. Availability is computed from the events in the window.

## Guidelines
- Always run `calendar.find_free_slots` before `calendar.create_event` when scheduling.
- Include timezone information with every calendar event.
- When inviting attendees, write a brief description of the meeting's purpose.
- Avoid back-to-back meetings without buffer. Respect 15-minute gaps where possible.
