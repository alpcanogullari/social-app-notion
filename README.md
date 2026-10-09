# VYBE

A campus social app based on `systemPromptFrameWork/initial-pitch`.

## Stack

- React + TypeScript and Vite for the frontend.
- Node.js + TypeScript and Express for the API.
- SQLite for accounts, sessions, saves, likes, RSVPs, follows, and album metadata.
- Local file storage for shared album photos.
- Leaflet + OpenStreetMap for event discovery.

## Run locally

Install Node.js 24 LTS, then:

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The API runs on port 3001.

If Node is not on your PATH, this checkout includes an ignored local runtime:

```bash
export PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH"
npm run dev
```

Create an account in the app. Different accounts have separate saves and follows;
RSVP counts and album photos are shared through the API. No seeded passwords.
Events and society membership counts are sample data, not live campus listings.
Users can also publish real community events through the backend API. See
[API examples](docs/api.md) for account creation and event publishing.

## Moderator demo

The backend currently treats every visitor as a moderator **on `/api/moderator`**.
No login is required for those endpoints. Anyone can change roles, society
memberships, leadership, feed preferences, and event visibility for any user.
There is no moderator frontend; use [moderator API examples](docs/moderation.md).

Normal `/api/events` requests still enforce the selected account's permissions,
so you can test ordinary people, event creators, and society leaders. New
accounts start as `normal`; grant `event_creator` to publish community events.
Existing accounts retain their previous community-publishing capability until
their roles are explicitly changed. Following a society is separate from joining it.

**This mode is for testing only.** Set `OPEN_MODERATOR_MODE=false` before sharing
a public deployment. Then moderator endpoints require a signed-in account with
the `moderator` role. Grant that role while demo mode is enabled before disabling it.

Run the projects separately from the repository root:

```bash
npm run dev:backend   # API: http://127.0.0.1:3001
npm run dev:frontend  # UI: http://127.0.0.1:5173
```

`npm run dev` starts both. Each project also has its own `package.json` and
can be run with `npm run dev` inside its directory after installing at the root.
The frontend proxies `/api`, `/media`, and `/uploads` to the backend locally.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Production build

```bash
npm run build
OPEN_MODERATOR_MODE=false WEB_ORIGIN=https://your-domain.example COOKIE_SECURE=true HOST=0.0.0.0 npm start
```

The frontend build is in `frontend/dist/`; host it separately as a static site.
`npm start` runs only the compiled API in `backend/dist/`, not the frontend.
For production, use an HTTPS reverse proxy: serve the frontend at `/` and route
`/api`, `/media`, and `/uploads` to the backend. Keep `backend/.data/` on
persistent storage. A single server can serve multiple users; multiple server
instances would need shared database and object storage instead of local files.
The server reads `PORT`, `HOST`, `APP_DATA_DIR`, `WEB_ORIGIN`, `COOKIE_SECURE`, and `OPEN_MODERATOR_MODE`
from its environment; `backend/.env.example` lists the defaults. It does not
auto-load `.env`. Relative data paths resolve from `backend/`, not the shell's
working directory.

For a separate API origin, set `VITE_API_URL=https://api.your-domain.example`
when building the frontend and `WEB_ORIGIN=https://your-domain.example` on
the backend. CORS allows that origin with credentials. Use the same HTTPS site
(for example, these two subdomains) for session cookies; unrelated domains may
block cookies. No internet deployment has been configured yet.

Uploads support JPG, PNG, and WebP, up to 10 files and 8 MB per file. Original
uploads can be downloaded from their event album. Album access follows the
event's visibility, including direct image URLs and downloads.
Photos, database files, local tools, and dependencies are ignored by Git.

## Society coordinators

After the coordinator creates an account, the server operator can grant access:

```bash
npm run coordinator -- coordinator@example.com music
```

Society IDs: `music`, `arts`, `outdoors`, `food`, `social`. Refresh the app, open an
event from that society, and toggle **Coordinator pick**. Access is enforced by
the API and applies only to the assigned society. Regular users cannot grant roles.

## Project structure

```text
frontend/src/             React screens and API client
frontend/tests/           Browser smoke tests
backend/src/              Express API, SQLite setup, and event data
backend/tests/            API integration tests
backend/public/media/     Sample event photography served by the API
backend/.data/            Accounts and uploads (ignored by Git)
shared/types.d.ts         Shared API types, with no runtime dependency
systemPromptFrameWork/    Original pitch and planning files
```

Sample photography: [Unsplash](https://unsplash.com). Map tiles:
[OpenStreetMap](https://www.openstreetmap.org/copyright).

This is a working local starter. Event publishing is available through the API.
Email verification, password recovery, upload moderation, and production hosting
are not implemented yet.
