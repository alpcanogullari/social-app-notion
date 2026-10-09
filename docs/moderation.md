# Moderator API

Backend only. Base URL: `http://127.0.0.1:3001`.

**Open demo mode is enabled by default:** anyone, even without an account, can
use these moderator routes. This does not bypass permissions on normal event
routes. Set `OPEN_MODERATOR_MODE=false` to require a signed-in moderator.
Do not expose open mode to untrusted users or use real personal data in it.

## Routes

| Method | Route                              | Result                                                                            |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/moderator`                   | Mode, role choices, society choices                                               |
| POST   | `/api/moderator/session`           | Create a normal demo account and session; reuse an existing session               |
| GET    | `/api/moderator/users`             | Accounts with roles, leadership, memberships, preferences; no passwords or tokens |
| GET    | `/api/moderator/users/:id`         | One account                                                                       |
| PATCH  | `/api/moderator/users/:id`         | Change roles, leadership, memberships, preferences                                |
| GET    | `/api/moderator/users/:id/events`  | Preview that user's actual filtered feed                                          |
| GET    | `/api/moderator/events`            | All events and their access rules, ignoring feed filters                          |
| PUT    | `/api/moderator/events/:id/access` | Replace an event's visibility and invited users                                   |
| GET    | `/api/moderator/audit`             | Latest 200 moderator changes, newest first                                        |
| GET    | `/api/me`                          | Signed-in account's current profile                                               |
| PUT    | `/api/societies/:id/membership`    | Join or leave as the signed-in user: `{"joined":true}`                            |

## Try It

Create a demo identity without signup. Keep the returned `user.id` as `USER_ID`:

```bash
curl -c /tmp/vybe-demo-cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"Demo Student"}' \
  http://127.0.0.1:3001/api/moderator/session
```

Give that person event creation, leadership of Music, and membership in Arts and Outdoors:

```bash
curl -X PATCH -H 'Content-Type: application/json' \
  -d '{"roles":["normal","event_creator","society_leader"],"leaderSocietyIds":["music"],"membershipSocietyIds":["arts","outdoors"]}' \
  http://127.0.0.1:3001/api/moderator/users/USER_ID
```

Restrict their feed to Music and Arts events from those societies:

```bash
curl -X PATCH -H 'Content-Type: application/json' \
  -d '{"eventPreferences":{"societyIds":["music","arts"],"interests":["Music","Arts"],"eventIds":null,"hiddenEventIds":[]}}' \
  http://127.0.0.1:3001/api/moderator/users/USER_ID
```

Preview their feed without switching anyone's session:

```bash
curl http://127.0.0.1:3001/api/moderator/users/USER_ID/events
```

Make a particular event visible only to its society's members:

```bash
curl -X PUT -H 'Content-Type: application/json' \
  -d '{"visibility":"members","allowedUserIds":[]}' \
  http://127.0.0.1:3001/api/moderator/events/EVENT_ID/access
```

Reset the person to an ordinary user in no societies with an unfiltered feed:

```bash
curl -X PATCH -H 'Content-Type: application/json' \
  -d '{"roles":["normal"],"leaderSocietyIds":[],"membershipSocietyIds":[],"eventPreferences":{"societyIds":null,"interests":null,"eventIds":null,"hiddenEventIds":[]}}' \
  http://127.0.0.1:3001/api/moderator/users/USER_ID
```

Inspect the selected account through its own session:

```bash
curl -b /tmp/vybe-demo-cookies.txt http://127.0.0.1:3001/api/me
curl -b /tmp/vybe-demo-cookies.txt http://127.0.0.1:3001/api/events
```

## Role Rules

- `normal`: view authorized events, join multiple societies, RSVP, like, save, upload photos.
- `event_creator`: additionally publish community events and manage owned events.
- `society_leader`: publish, edit, delete, and feature events for `leaderSocietyIds` only.
- `moderator`: publish for any society and manage any published event; view all event audiences.

Roles can be combined. Leadership automatically implies membership. Provide
`leaderSocietyIds` when assigning `society_leader`; clear leadership when removing
that role. Existing coordinator grants work as society leadership. A leader must
give up leadership before leaving that society. Following does not grant membership.
New accounts are normal. Legacy accounts retain event creation until explicitly
configured. Permissions are reloaded on each request; no logout is needed.
Demo accounts have no usable password; their cookie lasts seven days. Use normal
registration/login for durable credentials. Session creation is rate limited.

## Visibility Rules

- `public`: everyone, including anonymous viewers.
- `members`: society members and explicitly allowed users.
- `private`: explicitly allowed users only.

The owner, that society's leaders, and accounts with the moderator role always
have event access. Open moderator access applies to the moderator routes only;
it does not silently change a demo person's role or regular event feed.
Rules also protect album listings, upload actions, direct upload URLs, and
downloads. Unavailable events/photos return 404. Generic sample cover images
under `/media` remain public, but restricted sample album downloads are checked.

Feed preferences are separate from permission rules: they hide allowed events
from the feed but never grant access to restricted events. Direct links still
work when authorized. Filters are combined; `null` means unrestricted, `[]`
means no matches, and `hiddenEventIds` excludes specific events. Supply all four
preference fields when replacing preferences; other user patch fields are optional.
Unknown IDs, duplicate IDs/roles, inconsistent leadership, and extra fields are
rejected without making partial changes. Profiles and visibility persist in SQLite.

Before disabling open mode, grant a trusted account `{"roles":["moderator"]}`
(clear `leaderSocietyIds` too if needed), then restart with
`OPEN_MODERATOR_MODE=false`. Include that account's cookie on moderator requests.
