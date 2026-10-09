# Backend API

Run just the API with `npm run dev:api`. Base URL: `http://127.0.0.1:3001`.

## Event routes

| Method | Route                     | Access                                       |
| ------ | ------------------------- | -------------------------------------------- |
| GET    | `/api/events`             | Visible events, filtered by user preferences |
| GET    | `/api/events/:id`         | Event visibility rules                       |
| POST   | `/api/events`             | Event creators, scoped leaders, moderators   |
| PATCH  | `/api/events/:id`         | Creator host, scoped leader, moderator       |
| DELETE | `/api/events/:id`         | Creator host, scoped leader, moderator       |
| POST   | `/api/events/:id/actions` | Signed-in users; RSVP, like, save            |
| GET    | `/api/events/:id/photos`  | Event visibility rules                       |
| POST   | `/api/events/:id/photos`  | Signed-in users; multipart photos            |

An `event_creator` can publish under `societyId: "community"`. Posting under `music`,
`arts`, `outdoors`, `food`, or `social` requires that society's coordinator role.
Moderators can publish for any society. New accounts start as `normal`; use the
[moderator API](moderation.md) to grant roles, memberships, and visibility.
Ownership comes from the session cookie and cannot be supplied in the request.
Sample events cannot be edited or deleted through these routes.

## Example

Create an account and save its session cookie:

```bash
curl -c /tmp/vybe-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alex","email":"alex@example.com","password":"example-password-123"}' \
  http://127.0.0.1:3001/api/auth/register
```

Use the `user.id` returned above to grant publishing access in the current open demo:

```bash
curl -X PATCH -H 'Content-Type: application/json' \
  -d '{"roles":["normal","event_creator"]}' \
  http://127.0.0.1:3001/api/moderator/users/USER_ID
```

Publish an event with a future date:

```bash
curl -b /tmp/vybe-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"title":"Board game night","description":"Meet new people over a relaxed evening of board games.","societyId":"community","category":"Social","location":"Trinity College, Dublin","lat":53.3439,"lng":-6.257,"startsAt":"2026-10-16T18:00:00Z","price":0,"image":"/media/friends.jpg"}' \
  http://127.0.0.1:3001/api/events
```

The response contains `event.id`. Use it to edit the event:

```bash
curl -X PATCH -b /tmp/vybe-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"title":"Friday board game night"}' \
  http://127.0.0.1:3001/api/events/EVENT_ID
```

List events: `curl http://127.0.0.1:3001/api/events`.
Login to an existing account with `POST /api/auth/login` using email and password.
Logout with `POST /api/auth/logout`.

## Input rules

- Title: 3-100 characters; description: 10-2000 characters.
- Category: `Music`, `Arts`, `Outdoors`, `Food`, or `Social`.
- Date: ISO timestamp with an offset; new events must be in the future.
- Latitude: -90 to 90; longitude: -180 to 180.
- Price: numeric EUR amount, 0-1000; 0 means free.
- Cover: `/media/live.jpg`, `/media/arts.jpg`, `/media/hike.jpg`,
  `/media/table.jpg`, or `/media/friends.jpg`.
- New event albums start empty. Existing photo upload/download routes work with
  published events. Deletion also removes associated actions and album files.

Invalid input returns 400; missing login 401; insufficient permissions 403;
unknown or inaccessible events 404. Records persist in SQLite and are shared across users.
These endpoints run locally until the backend is deployed to a public host.
