# prime-ops

Live **Team Space Ops dashboard** for PrimeBridge. It reads the tickets in the ClickUp "Team Space"
(workspace `90152653226`, space `901511610772`) and shows them in the same dashboard design as the standalone HTML
(stone / charcoal / lime, iridescent glass cards, Audi-style motion).

Stack: Node.js · Express · express-session · Microsoft 365 sign-in (`@azure/msal-node`) · plain HTML/CSS/JS + Chart.js in the browser.

## How it works

```
Browser ──(signed in)──▶ /api/ops/tasks ──▶ ClickUp API v2   (token stays on the server)
```

* The ClickUp token is only ever used on the server. The browser never sees it.
* The server removes ticket IDs, links and people's names. People appear as **Member A, B, C…**. Names of anyone
  assigned to a ticket (plus names in `OPS_REDACT_NAMES`) are also hidden inside ticket titles. This follows the
  organisation rule.
* Results are cached for 60 seconds (keeps ClickUp rate limits safe). The page refreshes itself every 5 minutes and has a
  Refresh button. If ClickUp is briefly unreachable, the last good data stays on screen with a notice.
* Staff sign in with their **Microsoft 365 work account** (the one linked to their staff email). The site never sees the password. Only people in the Optimum Microsoft tenant, on `OPS_ALLOWED_DOMAIN`, can enter.

## First-time setup (Windows 11, VS Code)

Open `C:\Dev\prime-ops` in VS Code, then in a terminal:

```powershell
npm install
copy .env.example .env
code .env        # fill in SESSION_SECRET, the ENTRA_* values and ONE of the ClickUp options below
npm run dev
```

Open http://localhost:3100 and press **Sign in with Microsoft 365**.

### Microsoft 365 sign-in (one-off)

In the Entra admin centre (entra.microsoft.com) → App registrations → **New registration** (single tenant). You can
reuse the registration the CRM uses if you prefer; just add the extra redirect URI.

1. Authentication → Add a platform → **Web** → redirect URI `http://localhost:3100/auth/callback` (add the real address too when you deploy).
2. Certificates & secrets → New client secret → copy the **Value** into `ENTRA_CLIENT_SECRET`.
3. Overview → copy the Directory (tenant) ID and Application (client) ID into `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID`.
4. `ENTRA_REDIRECT_URI` in `.env` must match step 1 exactly. `OPS_ALLOWED_DOMAIN=optimumgroup.co.za` limits entry to staff emails.

### ClickUp access: pick one

**A. Personal API token (quickest).** In ClickUp: avatar → Settings → Apps → API Token → Generate. Paste it into
`CLICKUP_API_TOKEN` in `.env`. The dashboard shows what that person can see.

**B. OAuth app** ([getaccesstoken](https://developer.clickup.com/reference/getaccesstoken)). Create an app in ClickUp
(Settings → Apps → Create an App) and set its redirect URL to `http://localhost:3100/ops/clickup/callback` (use your real
address in production). Put `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET` and `CLICKUP_REDIRECT_URI` in `.env`, open the
dashboard and press **Connect ClickUp** once. The token is saved in `data/clickup-token.json` (ignored by Git).
Set `OPS_ADMIN_EMAILS` to limit who can press Connect.

Whichever you use, that ClickUp account must be able to see the Team Space.

## Tests

`npm test` runs the real app against a fake ClickUp server (no token or database needed). It checks sign-in, paging,
caching, token errors, and that no IDs, links or names reach the browser.

## Folder layout

```
prime-ops/
├─ index.js              starts the server
├─ app.js                routes: /login, /auth/microsoft + /auth/callback, /, /api/ops/tasks, /ops/clickup/connect + callback
├─ services/entra.js     Microsoft 365 sign-in (code flow + PKCE)
├─ services/clickup.js   ClickUp API, paging, cache, anonymising
├─ views/                dashboard.html, login.html
├─ public/               ops.css, ops.js, favicon.svg
└─ test/                 smoke test + sample ClickUp data
```

## Going live (production)

* `NODE_ENV=production`, a long random `SESSION_SECRET`, and HTTPS in front (IIS reverse proxy or similar).
* Keep `.env` and `data/` out of Git and out of any public folder.
* Add the production address as a second redirect URI in the Entra app, and set `ENTRA_REDIRECT_URI` to it.
