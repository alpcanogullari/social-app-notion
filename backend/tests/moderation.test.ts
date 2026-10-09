import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "../src/app.js";

const preferences = {
  societyIds: null,
  interests: null,
  eventIds: null,
  hiddenEventIds: [],
};
const details = {
  title: "Music meetup",
  description: "A music meetup with students from our societies.",
  societyId: "music",
  category: "Music",
  location: "Dublin campus",
  lat: 53.34,
  lng: -6.25,
  startsAt: new Date(Date.now() + 86400_000).toISOString(),
  price: 0,
  image: "/media/live.jpg",
};

test("open moderator mode edits scoped roles, multiple memberships, feed preferences, and protected albums", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vybe-moderation-"));
  const { app, db } = createApp(dir, { openModeratorMode: true });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (
    url: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
  ) =>
    fetch(base + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const patchUser = (id: string, body: unknown) =>
    request(`/api/moderator/users/${id}`, "PATCH", body);
  const visibleIds = async (cookie?: string) =>
    (
      (await (await request("/api/events", "GET", undefined, cookie)).json())
        .events as { id: string }[]
    ).map((e) => e.id);
  try {
    assert.equal(
      (await (await request("/api/moderator")).json()).openModeratorMode,
      true,
    );
    const aliceSession = await request("/api/moderator/session", "POST", {
      name: "Alice Demo",
    });
    assert.equal(aliceSession.status, 201);
    const alice = (await aliceSession.json()).user;
    const aliceCookie = aliceSession.headers.get("set-cookie")!.split(";")[0];
    const bobSession = await request("/api/moderator/session", "POST", {
      name: "Bob Demo",
    });
    const bob = (await bobSession.json()).user;
    const bobCookie = bobSession.headers.get("set-cookie")!.split(";")[0];
    assert.deepEqual(alice.roles, ["normal"]);
    assert.equal(
      (
        await request(
          "/api/events",
          "POST",
          { ...details, societyId: "community" },
          aliceCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await patchUser(alice.id, { roles: ["event_creator"] })).status,
      200,
    );
    assert.equal(
      (await request("/api/events", "POST", details, aliceCookie)).status,
      403,
    );
    assert.equal(
      (
        await patchUser(alice.id, {
          roles: ["normal", "society_leader"],
          leaderSocietyIds: ["music", "arts"],
          membershipSocietyIds: ["outdoors"],
        })
      ).status,
      200,
    );
    const profile = (
      await (await request(`/api/moderator/users/${alice.id}`)).json()
    ).user;
    assert.deepEqual(profile.membershipSocietyIds, [
      "arts",
      "music",
      "outdoors",
    ]);
    assert.equal(
      (
        await request(
          "/api/societies/music/membership",
          "PUT",
          { joined: false },
          aliceCookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/events",
          "POST",
          { ...details, societyId: "food" },
          aliceCookie,
        )
      ).status,
      403,
    );
    const created = await request("/api/events", "POST", details, aliceCookie);
    assert.equal(created.status, 201);
    const event = (await created.json()).event;
    const photoData = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = new FormData();
    upload.append(
      "photos",
      new Blob([photoData], { type: "image/png" }),
      "private.png",
    );
    const uploaded = await fetch(base + `/api/events/${event.id}/photos`, {
      method: "POST",
      headers: { Cookie: aliceCookie },
      body: upload,
    });
    assert.equal(uploaded.status, 201);
    const photo = (await uploaded.json())[0];
    const setAccess = (visibility: string, allowedUserIds: string[] = []) =>
      request(`/api/moderator/events/${event.id}/access`, "PUT", {
        visibility,
        allowedUserIds,
      });
    assert.equal((await setAccess("members")).status, 200);
    assert.ok(!(await visibleIds()).includes(event.id));
    assert.equal(
      (await request(`/api/events/${event.id}`, "GET", undefined, bobCookie))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/events/${event.id}/photos`,
          "GET",
          undefined,
          bobCookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/events/${event.id}/actions`,
          "POST",
          { kind: "save", active: true },
          bobCookie,
        )
      ).status,
      404,
    );
    const hiddenUpload = new FormData();
    hiddenUpload.append(
      "photos",
      new Blob([photoData], { type: "image/png" }),
      "blocked.png",
    );
    assert.equal(
      (
        await fetch(base + `/api/events/${event.id}/photos`, {
          method: "POST",
          headers: { Cookie: bobCookie },
          body: hiddenUpload,
        })
      ).status,
      404,
    );
    assert.equal(
      (await request(photo.url, "GET", undefined, bobCookie)).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/photos/${photo.id}/download`,
          "GET",
          undefined,
          bobCookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (await patchUser(bob.id, { membershipSocietyIds: ["music", "arts"] }))
        .status,
      200,
    );
    assert.ok((await visibleIds(bobCookie)).includes(event.id));
    assert.equal(
      (await request(photo.url, "GET", undefined, bobCookie)).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/photos/${photo.id}/download`,
          "GET",
          undefined,
          bobCookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/events/${event.id}`,
          "PATCH",
          { title: "Member edit" },
          bobCookie,
        )
      ).status,
      403,
    );
    assert.equal((await setAccess("private")).status, 200);
    assert.ok(!(await visibleIds(bobCookie)).includes(event.id));
    assert.equal((await setAccess("private", [bob.id])).status, 200);
    assert.ok((await visibleIds(bobCookie)).includes(event.id));
    assert.equal(
      (
        await patchUser(bob.id, {
          eventPreferences: { ...preferences, interests: ["Arts"] },
        })
      ).status,
      200,
    );
    assert.ok(!(await visibleIds(bobCookie)).includes(event.id));
    // Feed preferences never change authorization: a directly permitted event remains accessible.
    assert.equal(
      (await request(`/api/events/${event.id}`, "GET", undefined, bobCookie))
        .status,
      200,
    );
    assert.equal(
      (
        await patchUser(bob.id, {
          eventPreferences: { ...preferences, societyIds: [] },
        })
      ).status,
      200,
    );
    assert.deepEqual(await visibleIds(bobCookie), []);
    assert.equal(
      (
        await patchUser(bob.id, {
          eventPreferences: { ...preferences, eventIds: [event.id] },
        })
      ).status,
      200,
    );
    assert.deepEqual(await visibleIds(bobCookie), [event.id]);
    const preview = await (
      await request(`/api/moderator/users/${bob.id}/events`)
    ).json();
    assert.deepEqual(
      preview.events.map((e: { id: string }) => e.id),
      [event.id],
    );
    const bootstrap = await (
      await request("/api/bootstrap", "GET", undefined, bobCookie)
    ).json();
    assert.deepEqual(
      bootstrap.events.map((e: { id: string }) => e.id),
      [event.id],
    );
    assert.equal(
      bootstrap.societies.find((s: { id: string }) => s.id === "music").joined,
      true,
    );
    assert.equal(
      (
        await patchUser(bob.id, {
          eventPreferences: { ...preferences, hiddenEventIds: [event.id] },
        })
      ).status,
      200,
    );
    assert.ok(!(await visibleIds(bobCookie)).includes(event.id));
    assert.equal(
      (
        await patchUser(bob.id, {
          roles: ["moderator"],
          eventPreferences: preferences,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/events/${event.id}`,
          "PATCH",
          { title: "Moderator edit" },
          bobCookie,
        )
      ).status,
      200,
    );
    assert.equal((await patchUser(bob.id, { roles: ["normal"] })).status, 200);
    assert.equal(
      (
        await request(
          `/api/events/${event.id}`,
          "PATCH",
          { title: "Revoked edit" },
          bobCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await patchUser(alice.id, { roles: ["normal"], leaderSocietyIds: [] }))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/events/${event.id}`,
          "PATCH",
          { title: "Former leader edit" },
          aliceCookie,
        )
      ).status,
      403,
    );
    for (const bad of [
      { roles: ["admin"] },
      { roles: ["normal", "normal"] },
      { membershipSocietyIds: ["missing"] },
      { membershipSocietyIds: ["music", "music"] },
      { roles: ["society_leader"], leaderSocietyIds: [] },
      { eventPreferences: { ...preferences, eventIds: ["missing"] } },
      { id: bob.id },
      {},
    ])
      assert.equal((await patchUser(alice.id, bad)).status, 400);
    assert.equal((await setAccess("private", ["missing"])).status, 400);
    assert.equal((await request(`/api/moderator/users/missing`)).status, 404);
    assert.equal(
      (
        await request("/api/moderator/events/missing/access", "PUT", {
          visibility: "public",
          allowedUserIds: [],
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + `/api/moderator/users/${bob.id}`, {
          method: "PATCH",
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roles: ["moderator"] }),
        })
      ).status,
      403,
    );
    assert.ok(
      (await (await request("/api/moderator/events")).json()).events.some(
        (e: { id: string }) => e.id === event.id,
      ),
    );
    const audit = (await (await request("/api/moderator/audit")).json())
      .entries;
    assert.ok(
      audit.some((e: { action: string }) => e.action === "update_event_access"),
    );
    const restarted = createApp(dir, { openModeratorMode: false });
    try {
      assert.equal(
        restarted.db
          .prepare("SELECT settings FROM event_policies WHERE event_id=?")
          .get(event.id)?.settings,
        JSON.stringify({ visibility: "private", allowedUserIds: [bob.id] }),
      );
      assert.equal(
        restarted.db
          .prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id=?")
          .get(bob.id)?.n,
        2,
      );
    } finally {
      restarted.db.close();
    }
    assert.equal(
      (
        await request(
          "/api/societies/music/membership",
          "PUT",
          { joined: false },
          bobCookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await patchUser(bob.id, { roles: ["moderator"] })).status,
      200,
    );
    assert.equal(
      (await request(`/api/events/${event.id}`, "DELETE", undefined, bobCookie))
        .status,
      200,
    );
    assert.equal(
      db
        .prepare("SELECT event_id FROM event_policies WHERE event_id=?")
        .get(event.id),
      undefined,
    );
    assert.equal(
      (await request(photo.url, "GET", undefined, bobCookie)).status,
      404,
    );
    assert.equal(
      (
        await request("/api/moderator/events/after-hours/access", "PUT", {
          visibility: "private",
          allowedUserIds: [],
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/photos/sample-after-hours-0/download")).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/photos/sample-after-hours-0/download",
          "GET",
          undefined,
          bobCookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await patchUser(alice.id, {
          roles: ["society_leader"],
          leaderSocietyIds: ["food"],
        })
      ).status,
      200,
    );
    assert.equal(
      (await patchUser(alice.id, { leaderSocietyIds: [] })).status,
      200,
    );
    assert.deepEqual(
      (await (await request(`/api/moderator/users/${alice.id}`)).json()).user
        .roles,
      ["normal"],
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("closed moderator mode rejects anonymous/normal users and honors persistent moderator roles", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vybe-closed-"));
  const { app, db } = createApp(dir, { openModeratorMode: false });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/api/moderator/users")).status, 403);
    assert.equal(
      (
        await fetch(base + "/api/moderator/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Anonymous" }),
        })
      ).status,
      403,
    );
    const registered = await fetch(base + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Normal User",
        email: "normal@example.com",
        password: "password123",
      }),
    });
    const user = (await registered.json()).user;
    assert.deepEqual(user.roles, ["normal"]);
    const headers = {
      Cookie: registered.headers.get("set-cookie")!.split(";")[0],
    };
    assert.equal(
      (await fetch(base + "/api/moderator/users", { headers })).status,
      403,
    );
    db.prepare("INSERT INTO user_roles VALUES (?, ?)").run(
      user.id,
      "moderator",
    );
    assert.equal(
      (await fetch(base + "/api/moderator/users", { headers })).status,
      200,
    );
    db.prepare(
      "DELETE FROM user_roles WHERE user_id=? AND role='moderator'",
    ).run(user.id);
    assert.equal(
      (await fetch(base + "/api/moderator/users", { headers })).status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
