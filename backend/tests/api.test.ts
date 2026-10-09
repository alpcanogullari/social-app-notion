import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import type { Bootstrap, AlbumPhoto, CampusEvent } from "@vybe/shared";

test("accounts, actions, and albums stay shared while account state stays separate", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), ".vybe-test-"));
  const { app, db } = createApp(dir);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (url: string, body?: unknown, cookie?: string) =>
    fetch(base + url, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await request("/")).status, 404);
    assert.equal((await request("/api/health")).status, 200);
    const preflight = await fetch(base + "/api/events", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:5173",
    );
    assert.equal(
      preflight.headers.get("access-control-allow-credentials"),
      "true",
    );
    const untrusted = await fetch(base + "/api/events", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
    assert.equal((await request("/media/arts.jpg")).status, 200);
    const original: Bootstrap = await (await request("/api/bootstrap")).json();
    assert.equal(original.user, null);
    assert.equal(original.events.length, 5);
    assert.equal(
      (
        await request("/api/events/after-hours/actions", {
          kind: "save",
          active: true,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/api/auth/register", {
          name: "A",
          email: "bad",
          password: "x",
        })
      ).status,
      400,
    );
    const alice = await request("/api/auth/register", {
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
    });
    assert.equal(alice.status, 201);
    assert.ok(alice.headers.get("set-cookie")?.includes("HttpOnly"));
    const aliceCookie = alice.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await request("/api/auth/login", {
          email: "alice@example.com",
          password: "wrongpass",
        })
      ).status,
      401,
    );
    const bob = await request("/api/auth/register", {
      name: "Bob",
      email: "bob@example.com",
      password: "password123",
    });
    assert.equal(bob.status, 201);
    const bobCookie = bob.headers.get("set-cookie")!.split(";")[0];
    for (const kind of ["like", "save", "going"]) {
      assert.equal(
        (
          await request(
            "/api/events/after-hours/actions",
            { kind, active: true },
            aliceCookie,
          )
        ).status,
        200,
      );
    }
    await request(
      "/api/events/after-hours/actions",
      { kind: "like", active: true },
      aliceCookie,
    );
    const aliceData: Bootstrap = await (
      await request("/api/bootstrap", undefined, aliceCookie)
    ).json();
    const bobData: Bootstrap = await (
      await request("/api/bootstrap", undefined, bobCookie)
    ).json();
    const aliceEvent = aliceData.events.find((e) => e.id === "after-hours")!;
    const bobEvent = bobData.events.find((e) => e.id === "after-hours")!;
    assert.equal(aliceEvent.saved, true);
    assert.equal(aliceEvent.going, true);
    assert.equal(bobEvent.saved, false);
    assert.equal(bobEvent.going, false);
    assert.equal(bobEvent.likes, original.events[0].likes + 1);
    assert.equal(bobEvent.goingCount, original.events[0].goingCount + 1);
    assert.equal(
      (
        await request(
          "/api/events/welcome-night/actions",
          { kind: "going", active: true },
          aliceCookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/societies/music/follow",
          { active: true },
          aliceCookie,
        )
      ).status,
      200,
    );
    const followed: Bootstrap = await (
      await request("/api/bootstrap", undefined, aliceCookie)
    ).json();
    assert.equal(
      followed.societies.find((s) => s.id === "music")!.following,
      true,
    );
    assert.equal(
      (
        await request(
          "/api/events/after-hours/feature",
          { active: false },
          bobCookie,
        )
      ).status,
      403,
    );
    db.prepare("INSERT INTO coordinator_roles VALUES (?, ?)").run(
      aliceData.user!.id,
      "music",
    );
    assert.equal(
      (
        await request(
          "/api/events/after-hours/feature",
          { active: false },
          aliceCookie,
        )
      ).status,
      200,
    );
    const featured: Bootstrap = await (
      await request("/api/bootstrap", undefined, bobCookie)
    ).json();
    assert.equal(
      featured.events.find((e) => e.id === "after-hours")!.featured,
      false,
    );
    assert.equal(
      (
        await request(
          "/api/events/creative-evening/feature",
          { active: false },
          aliceCookie,
        )
      ).status,
      403,
    );

    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = new FormData();
    upload.append(
      "photos",
      new Blob([image], { type: "image/png" }),
      "moment.png",
    );
    const uploaded = await fetch(base + "/api/events/welcome-night/photos", {
      method: "POST",
      headers: { Cookie: aliceCookie },
      body: upload,
    });
    assert.equal(uploaded.status, 201);
    const gallery: AlbumPhoto[] = await uploaded.json();
    const added = gallery.find((p) => p.uploadedBy === "Alice")!;
    assert.ok(added);
    const shared: AlbumPhoto[] = await (
      await request("/api/events/welcome-night/photos", undefined, bobCookie)
    ).json();
    assert.ok(shared.some((p) => p.id === added.id));
    assert.equal((await request(added.url)).status, 200);
    const download = await request(`/api/photos/${added.id}/download`);
    assert.equal(download.status, 200);
    assert.match(
      download.headers.get("content-disposition") || "",
      /attachment/,
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), image);

    const invalid = new FormData();
    invalid.append(
      "photos",
      new Blob(['<svg onload="alert(1)"></svg>'], { type: "image/svg+xml" }),
      "bad.svg",
    );
    assert.equal(
      (
        await fetch(base + "/api/events/welcome-night/photos", {
          method: "POST",
          headers: { Cookie: aliceCookie },
          body: invalid,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/events/after-hours/actions", {
          method: "POST",
          headers: {
            Origin: "https://untrusted.example",
            Cookie: aliceCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ kind: "like", active: false }),
        })
      ).status,
      403,
    );
    await request("/api/auth/logout", {}, aliceCookie);
    const loggedOut: Bootstrap = await (
      await request("/api/bootstrap", undefined, aliceCookie)
    ).json();
    assert.equal(loggedOut.user, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("users can publish community events with ownership, society permissions, and shared albums", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), ".vybe-events-"));
  const { app, db } = createApp(dir);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (
    route: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const details = {
    title: "Campus board game night",
    description: "Meet new people for a relaxed evening of board games.",
    societyId: "community",
    category: "Social",
    location: "Trinity College, Dublin",
    lat: 53.3439,
    lng: -6.257,
    startsAt: new Date(Date.now() + 86400_000).toISOString(),
    price: 0,
    image: "/media/friends.jpg",
  };
  try {
    assert.equal((await request("/api/events", "POST", details)).status, 401);
    const alice = await request("/api/auth/register", "POST", {
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
    });
    const aliceUser = (await alice.json()).user;
    const aliceCookie = alice.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await request(`/api/moderator/users/${aliceUser.id}`, "PATCH", {
          roles: ["normal", "event_creator"],
        })
      ).status,
      200,
    );
    const bob = await request("/api/auth/register", "POST", {
      name: "Bob",
      email: "bob@example.com",
      password: "password123",
    });
    const bobCookie = bob.headers.get("set-cookie")!.split(";")[0];
    for (const invalid of [
      { ...details, title: "x" },
      { ...details, lat: 91 },
      { ...details, lng: -181 },
      { ...details, price: -1 },
      { ...details, startsAt: "invalid" },
      { ...details, startsAt: new Date(Date.now() - 86400_000).toISOString() },
      { ...details, image: "https://untrusted.example/image.jpg" },
      { ...details, ownerId: "another-user" },
    ])
      assert.equal(
        (await request("/api/events", "POST", invalid, aliceCookie)).status,
        400,
      );
    assert.equal(
      (
        await request(
          "/api/events",
          "POST",
          { ...details, societyId: "music" },
          aliceCookie,
        )
      ).status,
      403,
    );
    const created = await request("/api/events", "POST", details, aliceCookie);
    assert.equal(created.status, 201);
    const event = (await created.json()).event;
    assert.equal(event.ownerId, aliceUser.id);
    assert.equal(event.hostName, "Alice");
    assert.equal(event.isSample, false);
    assert.equal(event.price, "Free");
    assert.equal(event.goingCount, 0);
    assert.ok(
      (await (await request("/api/events")).json()).events.some(
        (e: CampusEvent) => e.id === event.id,
      ),
    );
    assert.equal((await request(`/api/events/${event.id}/photos`)).status, 200);
    assert.deepEqual(
      await (await request(`/api/events/${event.id}/photos`)).json(),
      [],
    );

    const responses = await Promise.all(
      [aliceCookie, bobCookie].map((cookie) =>
        request(
          `/api/events/${event.id}/actions`,
          "POST",
          { kind: "going", active: true },
          cookie,
        ),
      ),
    );
    assert.ok(responses.every((response) => response.status === 200));
    const shared = (
      await (
        await request(`/api/events/${event.id}`, "GET", undefined, bobCookie)
      ).json()
    ).event;
    assert.equal(shared.goingCount, 2);
    assert.equal(shared.going, true);
    assert.equal(
      (
        await request(
          `/api/events/${event.id}`,
          "PATCH",
          { title: "Changed by Bob" },
          bobCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request(`/api/events/${event.id}`, "DELETE", undefined, bobCookie))
        .status,
      403,
    );
    assert.equal(
      (await request(`/api/events/${event.id}`, "PATCH", {}, aliceCookie))
        .status,
      400,
    );
    const edit = await request(
      `/api/events/${event.id}`,
      "PATCH",
      { title: "Updated game night", price: 3.5 },
      aliceCookie,
    );
    assert.equal(edit.status, 200);
    assert.equal((await edit.json()).event.price, "EUR 3.50");

    db.prepare("INSERT INTO coordinator_roles VALUES (?, ?)").run(
      aliceUser.id,
      "music",
    );
    const official = await request(
      "/api/events",
      "POST",
      { ...details, societyId: "music", category: "Music" },
      aliceCookie,
    );
    assert.equal(official.status, 201);
    const officialId = (await official.json()).event.id;
    assert.equal(
      (
        await request(
          `/api/events/${officialId}/feature`,
          "POST",
          { active: true },
          aliceCookie,
        )
      ).status,
      200,
    );
    await request(
      `/api/events/${officialId}`,
      "PATCH",
      { title: "Official music night" },
      aliceCookie,
    );
    assert.equal(
      (await (await request(`/api/events/${officialId}`)).json()).event
        .featured,
      true,
    );
    assert.equal(
      (
        await request(
          `/api/events/${officialId}`,
          "PATCH",
          { societyId: "arts" },
          aliceCookie,
        )
      ).status,
      403,
    );

    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append(
      "photos",
      new Blob([image], { type: "image/png" }),
      "game-night.png",
    );
    const uploaded = await fetch(`${base}/api/events/${event.id}/photos`, {
      method: "POST",
      headers: { Cookie: bobCookie },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const photo = (await uploaded.json())[0];
    assert.equal(photo.uploadedBy, "Bob");
    const photoPath = path.join(dir, "uploads", path.basename(photo.url));
    assert.ok(existsSync(photoPath));

    const persisted = createApp(dir);
    try {
      assert.equal(
        persisted.db
          .prepare("SELECT title FROM published_events WHERE id=?")
          .get(event.id)!.title,
        "Updated game night",
      );
    } finally {
      persisted.db.close();
    }
    assert.equal(
      (
        await request(
          `/api/events/${event.id}`,
          "DELETE",
          undefined,
          aliceCookie,
        )
      ).status,
      200,
    );
    assert.equal((await request(`/api/events/${event.id}`)).status, 404);
    assert.equal((await request(`/api/events/${event.id}/photos`)).status, 404);
    assert.equal(
      (await request(`/api/photos/${photo.id}/download`)).status,
      404,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS n FROM actions WHERE event_id=?")
        .get(event.id)!.n,
      0,
    );
    assert.equal(existsSync(photoPath), false);
    assert.equal((await request("/api/events/missing")).status, 404);
    assert.equal(
      (
        await request(
          "/api/events/after-hours",
          "PATCH",
          { title: "Change sample" },
          aliceCookie,
        )
      ).status,
      404,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
