# Connecting Google (Gmail + Calendar)

The `@boringos/connector-google` Module needs an OAuth client.
Two minutes in Google Cloud Console, then two env vars.

> If you got here from the [README](../../README.md) quickstart,
> you should already have `pnpm dev` running on
> `http://localhost:3000`. Come back to this doc once those steps
> are done — the OAuth callback won't resolve otherwise.

---

## 1. Google Cloud Console

[`console.cloud.google.com`](https://console.cloud.google.com)

1. **Create a project** (or pick an existing one).
2. **Enable APIs** — `APIs & Services` → `Library`:
   - Gmail API
   - Google Calendar API
3. **OAuth consent screen** — `APIs & Services` → `OAuth consent screen`:
   - User type: `External` (or `Internal` if you're on Workspace)
   - Add your email as a test user while in `Testing` status
   - Add these scopes:
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/calendar.events`
4. **Create OAuth 2.0 Client** — `APIs & Services` → `Credentials`
   → `Create credentials` → `OAuth client ID`:
   - Application type: `Web application`
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs:
     `http://localhost:3000/api/connectors/oauth/google/callback`
5. Copy the **Client ID** and **Client secret**.

## 2. Environment variables

Drop these in `.env.local` at the repo root (copy
[`.env.example`](../../.env.example) if you haven't already):

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Restart `pnpm dev`, head to the shell's **Connectors** screen,
click **Connect Google**, and finish the OAuth flow. Gmail and
Calendar tools are now available to every agent in that tenant.

## 3. Production hosts

Swap `http://localhost:3000` for your public origin everywhere
in step 1 (both JavaScript origins and the redirect URI), publish
the OAuth consent screen, and set the same two env vars in your
deployment environment.

---

## Troubleshooting

**`redirect_uri_mismatch` after clicking Connect.** The redirect
URI in your OAuth client must match the framework's callback
exactly: `<BORINGOS_SHELL_URL or http://localhost:3000>/api/connectors/oauth/google/callback`.
If you run the shell on a different host (e.g. behind a reverse
proxy), update both the Cloud Console entry **and** the
`BORINGOS_SHELL_URL` env var so the redirect resolves.

**`access_denied` mid-flow.** While the consent screen is in
`Testing` status, only emails you added under "Test users" can
finish the flow. Either add your address there or move the
consent screen to `In production`.

**Gmail returns `403 insufficientPermissions` when the agent runs.**
The OAuth scopes were not requested at consent time. Disconnect
the connector in the shell, re-add the missing scopes in the
Cloud Console under `OAuth consent screen → Scopes`, then
reconnect.
