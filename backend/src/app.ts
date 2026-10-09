import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import cors from "cors";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { events, societies } from "./seed.js";
import type { AlbumPhoto, CampusEvent, User } from "@vybe/shared";
import { defaultDataDir, publicDir } from "./paths.js";
import { createModeration } from "./moderation.js";

type Row = Record<string, unknown>;
type StoredEvent = Omit<CampusEvent, "liked" | "saved" | "going"> & {
  ownerId?: string;
  hostName?: string;
  isSample: boolean;
};
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function createApp(
  dataDir = defaultDataDir,
  options: { openModeratorMode?: boolean } = {},
) {
  mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "vybe.sqlite"));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER);
    CREATE TABLE IF NOT EXISTS actions (user_id TEXT REFERENCES users(id), event_id TEXT, kind TEXT, PRIMARY KEY(user_id,event_id,kind));
    CREATE TABLE IF NOT EXISTS follows (user_id TEXT REFERENCES users(id), society_id TEXT, PRIMARY KEY(user_id,society_id));
    CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT REFERENCES users(id), name TEXT, file TEXT);
    CREATE TABLE IF NOT EXISTS event_dates (id TEXT PRIMARY KEY, starts_at TEXT);
    CREATE TABLE IF NOT EXISTS coordinator_roles (user_id TEXT REFERENCES users(id), society_id TEXT, PRIMARY KEY(user_id,society_id));
    CREATE TABLE IF NOT EXISTS event_features (event_id TEXT PRIMARY KEY, featured INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS published_events (
      id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id), society_id TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
      location TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
      starts_at TEXT NOT NULL, price TEXT NOT NULL, image TEXT NOT NULL
    );
  `);
  const moderation = createModeration(
    db,
    options.openModeratorMode ?? process.env.OPEN_MODERATOR_MODE !== "false",
  );
  for (const event of events) {
    db.prepare("INSERT OR IGNORE INTO event_dates VALUES (?, ?)").run(
      event.id,
      event.startsAt,
    );
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  const webOrigins = process.env.WEB_ORIGIN
    ? [process.env.WEB_ORIGIN]
    : ["http://127.0.0.1:5173", "http://localhost:5173"];
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || webOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      const allowed = [...webOrigins, `${req.protocol}://${req.get("host")}`];
      if (!allowed.includes(req.headers.origin))
        return res
          .status(403)
          .json({ error: "Request origin is not allowed." });
    }
    next();
  });

  const userFor = (req: Request): User | null => {
    const token = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("vybe_session="))
      ?.slice(13);
    if (!token) return null;
    const row = db
      .prepare(
        "SELECT users.id, users.name, users.email FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>?",
      )
      .get(hashToken(token), Date.now());
    if (!row) return null;
    return moderation.profile(String(row.id));
  };
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    const user = userFor(req);
    if (!user) return res.status(401).json({ error: "Sign in to join in." });
    res.locals.user = user;
    next();
  };
  const publishedEvents = (): StoredEvent[] =>
    db
      .prepare(
        "SELECT published_events.*, users.name AS host FROM published_events JOIN users ON users.id=published_events.owner_id ORDER BY published_events.rowid DESC",
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        ownerId: String(row.owner_id),
        hostName: String(row.host),
        societyId: String(row.society_id),
        title: String(row.title),
        description: String(row.description),
        category: row.category as CampusEvent["category"],
        location: String(row.location),
        lat: Number(row.lat),
        lng: Number(row.lng),
        startsAt: String(row.starts_at),
        price: String(row.price),
        image: String(row.image),
        likes: 0,
        goingCount: 0,
        featured: false,
        kind:
          new Date(String(row.starts_at)).getTime() < Date.now()
            ? "highlight"
            : "upcoming",
        isSample: false,
      }));
  const allEvents = (): StoredEvent[] => [
    ...publishedEvents(),
    ...events.map((event) => ({
      ...event,
      isSample: true,
      startsAt: String(
        db
          .prepare("SELECT starts_at FROM event_dates WHERE id=?")
          .get(event.id)!.starts_at,
      ),
    })),
  ];
  const findEvent = (id: string) =>
    allEvents().find((event) => event.id === id);
  const eventsFor = (user: User | null, filtered = true) => {
    const actions = user
      ? db
          .prepare("SELECT event_id, kind FROM actions WHERE user_id=?")
          .all(user.id)
      : [];
    return allEvents()
      .filter((event) => !filtered || moderation.inFeed(event, user))
      .map((event) => {
        const feature = db
          .prepare("SELECT featured FROM event_features WHERE event_id=?")
          .get(event.id);
        return {
          ...event,
          featured: feature ? Boolean(feature.featured) : event.featured,
          likes:
            event.likes +
            Number(
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM actions WHERE event_id=? AND kind='like'",
                )
                .get(event.id)!.n,
            ),
          goingCount:
            event.goingCount +
            Number(
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM actions WHERE event_id=? AND kind='going'",
                )
                .get(event.id)!.n,
            ),
          liked: actions.some(
            (a) => a.event_id === event.id && a.kind === "like",
          ),
          saved: actions.some(
            (a) => a.event_id === event.id && a.kind === "save",
          ),
          going: actions.some(
            (a) => a.event_id === event.id && a.kind === "going",
          ),
        };
      });
  };
  app.use("/api/events/:id", (req, res, next) => {
    const event = findEvent(String(req.params.id));
    if (!event || !moderation.canAccess(event, userFor(req)))
      return res.status(404).json({ error: "Event not found." });
    next();
  });
  app.get("/api/events", (req, res) =>
    res.json({ events: eventsFor(userFor(req)) }),
  );
  app.get("/api/events/:id", (req, res) => {
    const event = eventsFor(userFor(req), false).find(
      (e) => e.id === req.params.id,
    );
    if (!event) return res.status(404).json({ error: "Event not found." });
    res.json({ event });
  });
  const covers = [
    "/media/live.jpg",
    "/media/arts.jpg",
    "/media/hike.jpg",
    "/media/table.jpg",
    "/media/friends.jpg",
  ] as const;
  const eventSchema = z
    .object({
      title: z.string().trim().min(3).max(100),
      description: z.string().trim().min(10).max(2000),
      societyId: z.string(),
      category: z.enum(["Music", "Arts", "Outdoors", "Food", "Social"]),
      location: z.string().trim().min(3).max(180),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      startsAt: z.iso.datetime({ offset: true }),
      price: z.number().min(0).max(1000),
      image: z.enum(covers),
    })
    .strict();
  const canHost = moderation.canHost;
  app.post("/api/events", requireUser, (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Check the event details, date, and map location." });
    const details = parsed.data;
    if (
      !societies.some((s) => s.id === details.societyId) ||
      !canHost(res.locals.user, details.societyId)
    )
      return res.status(403).json({
        error:
          "Only a society coordinator can publish on behalf of that society.",
      });
    if (Date.parse(details.startsAt) <= Date.now())
      return res
        .status(400)
        .json({ error: "Choose a future date for your event." });
    const id = randomUUID();
    db.prepare(
      "INSERT INTO published_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      res.locals.user.id,
      details.societyId,
      details.title,
      details.description,
      details.category,
      details.location,
      details.lat,
      details.lng,
      new Date(details.startsAt).toISOString(),
      details.price === 0 ? "Free" : `EUR ${details.price.toFixed(2)}`,
      details.image,
    );
    res
      .status(201)
      .json({
        event: eventsFor(res.locals.user, false).find((e) => e.id === id),
      });
  });
  app.patch("/api/events/:id", requireUser, (req, res) => {
    const event = publishedEvents().find((e) => e.id === req.params.id);
    if (!event)
      return res.status(404).json({ error: "Published event not found." });
    if (!moderation.canManage(event, res.locals.user))
      return res
        .status(403)
        .json({
          error:
            "An event creator host, society leader, or moderator is required to edit this event.",
        });
    const patch = eventSchema.partial().safeParse(req.body);
    if (!patch.success || Object.keys(patch.data).length === 0)
      return res
        .status(400)
        .json({ error: "Provide at least one valid event field to update." });
    const parsed = eventSchema.safeParse({
      title: event.title,
      description: event.description,
      societyId: event.societyId,
      category: event.category,
      location: event.location,
      lat: event.lat,
      lng: event.lng,
      startsAt: event.startsAt,
      price: event.price === "Free" ? 0 : Number(event.price.slice(4)),
      image: event.image,
      ...patch.data,
    });
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Check the event details, date, and map location." });
    const details = parsed.data;
    if (
      !societies.some((s) => s.id === details.societyId) ||
      (details.societyId !== event.societyId &&
        !canHost(res.locals.user, details.societyId))
    )
      return res
        .status(403)
        .json({ error: "Coordinator access is required for this society." });
    if (
      Date.parse(details.startsAt) <= Date.now() &&
      Date.parse(details.startsAt) !== Date.parse(event.startsAt)
    )
      return res
        .status(400)
        .json({ error: "Choose a future date for your event." });
    db.prepare(
      "UPDATE published_events SET society_id=?, title=?, description=?, category=?, location=?, lat=?, lng=?, starts_at=?, price=?, image=? WHERE id=?",
    ).run(
      details.societyId,
      details.title,
      details.description,
      details.category,
      details.location,
      details.lat,
      details.lng,
      new Date(details.startsAt).toISOString(),
      details.price === 0 ? "Free" : `EUR ${details.price.toFixed(2)}`,
      details.image,
      event.id,
    );
    if (event.societyId !== details.societyId)
      db.prepare("DELETE FROM event_features WHERE event_id=?").run(event.id);
    res.json({
      event: eventsFor(res.locals.user, false).find((e) => e.id === event.id),
    });
  });
  app.delete("/api/events/:id", requireUser, (req, res) => {
    const event = publishedEvents().find((e) => e.id === req.params.id);
    if (!event)
      return res.status(404).json({ error: "Published event not found." });
    if (!moderation.canManage(event, res.locals.user))
      return res
        .status(403)
        .json({
          error:
            "An event creator host, society leader, or moderator is required to delete this event.",
        });
    const files = db
      .prepare("SELECT file FROM photos WHERE event_id=?")
      .all(event.id);
    db.exec("BEGIN");
    try {
      for (const table of [
        "actions",
        "photos",
        "event_features",
        "event_policies",
      ])
        db.prepare(`DELETE FROM ${table} WHERE event_id=?`).run(event.id);
      db.prepare("DELETE FROM published_events WHERE id=?").run(event.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const file of files) {
      try {
        unlinkSync(path.join(dataDir, "uploads", String(file.file)));
      } catch (error) {
        console.error("Could not remove deleted event photo:", error);
      }
    }
    res.json({ ok: true });
  });
  const session = (res: Response, userId: string) => {
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    const age = 60 * 60 * 24 * 7;
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      hashToken(token),
      userId,
      Date.now() + age * 1000,
    );
    res.cookie("vybe_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: age * 1000,
    });
  };

  const authSchema = z.object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(8).max(128),
  });
  const attempts = new Map<string, { count: number; expires: number }>();
  app.use(["/api/auth", "/api/moderator/session"], (req, res, next) => {
    if (req.method !== "POST") return next();
    const key = req.ip || "local";
    const now = Date.now();
    for (const [ip, attempt] of attempts)
      if (attempt.expires < now) attempts.delete(ip);
    const attempt = attempts.get(key) || { count: 0, expires: now + 60_000 };
    attempt.count++;
    attempts.set(key, attempt);
    if (attempt.count > 20)
      return res
        .status(429)
        .json({ error: "Too many attempts. Try again in a minute." });
    next();
  });
  app.post("/api/auth/register", (req, res) => {
    const parsed = authSchema
      .extend({ name: z.string().trim().min(2).max(60) })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "Use a name, valid email, and a password of 8+ characters.",
      });
    const { name, email, password } = parsed.data;
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
      return res
        .status(409)
        .json({ error: "An account with that email already exists." });
    const salt = randomBytes(16).toString("hex");
    const id = randomUUID();
    db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(
      id,
      name,
      email,
      `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    );
    db.prepare("INSERT INTO role_profiles VALUES (?)").run(id);
    db.prepare("INSERT INTO user_roles VALUES (?, ?)").run(id, "normal");
    session(res, id);
    res.status(201).json({ user: moderation.profile(id) });
  });
  app.post("/api/auth/login", (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Enter your email and password." });
    const row = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(parsed.data.email) as Row | undefined;
    const [salt, stored] = row
      ? String(row.password).split(":")
      : ["invalid-user-salt", "00".repeat(64)];
    const candidate = scryptSync(parsed.data.password, salt, 64);
    if (!timingSafeEqual(candidate, Buffer.from(stored, "hex")) || !row)
      return res.status(401).json({ error: "Email or password is incorrect." });
    session(res, String(row.id));
    res.json({ user: moderation.profile(String(row.id)) });
  });
  app.post("/api/auth/logout", (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("vybe_session="))
      ?.slice(13);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token=?").run(hashToken(token));
    res.clearCookie("vybe_session");
    res.json({ ok: true });
  });

  app.use(
    "/api/moderator",
    moderation.router({
      userFor,
      allEvents,
      eventsFor,
      startSession: (res, name) => {
        const id = randomUUID();
        const salt = randomBytes(16).toString("hex");
        db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(
          id,
          name,
          `demo-${id}@example.invalid`,
          `${salt}:${scryptSync(randomBytes(32).toString("hex"), salt, 64).toString("hex")}`,
        );
        db.prepare("INSERT INTO role_profiles VALUES (?)").run(id);
        db.prepare("INSERT INTO user_roles VALUES (?, ?)").run(id, "normal");
        session(res, id);
        return moderation.profile(id)!;
      },
    }),
  );
  app.get("/api/me", requireUser, (_req, res) =>
    res.json({ user: res.locals.user }),
  );
  app.put("/api/societies/:id/membership", requireUser, (req, res) => {
    const id = String(req.params.id);
    if (!societies.some((s) => s.id === id))
      return res.status(404).json({ error: "Society not found." });
    const parsed = z
      .object({ joined: z.boolean() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Provide joined: true or false." });
    if (
      !parsed.data.joined &&
      res.locals.user.coordinatorSocietyIds.includes(id)
    )
      return res
        .status(409)
        .json({ error: "Remove leadership before leaving this society." });
    if (parsed.data.joined)
      db.prepare("INSERT OR IGNORE INTO memberships VALUES (?, ?)").run(
        res.locals.user.id,
        id,
      );
    else
      db.prepare(
        "DELETE FROM memberships WHERE user_id=? AND society_id=?",
      ).run(res.locals.user.id, id);
    res.json({ user: moderation.profile(res.locals.user.id) });
  });

  app.get("/api/bootstrap", (req, res) => {
    const user = userFor(req);
    const following = user
      ? db
          .prepare("SELECT society_id FROM follows WHERE user_id=?")
          .all(user.id)
      : [];
    res.json({
      user,
      events: eventsFor(user),
      societies: societies.map((s) => ({
        ...s,
        following: following.some((f) => f.society_id === s.id),
        joined: Boolean(
          user &&
            moderation.profile(user.id)?.membershipSocietyIds.includes(s.id),
        ),
        leading: Boolean(user?.coordinatorSocietyIds.includes(s.id)),
      })),
    });
  });

  app.post("/api/events/:id/actions", requireUser, (req, res) => {
    const parsed = z
      .object({ kind: z.enum(["like", "save", "going"]), active: z.boolean() })
      .safeParse(req.body);
    const event = findEvent(String(req.params.id));
    if (!event) return res.status(404).json({ error: "Event not found." });
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid event action." });
    if (parsed.data.kind === "going" && event.kind === "highlight")
      return res
        .status(400)
        .json({ error: "This event has already happened." });
    const { kind, active } = parsed.data;
    if (active)
      db.prepare("INSERT OR IGNORE INTO actions VALUES (?, ?, ?)").run(
        res.locals.user.id,
        event.id,
        kind,
      );
    else
      db.prepare(
        "DELETE FROM actions WHERE user_id=? AND event_id=? AND kind=?",
      ).run(res.locals.user.id, event.id, kind);
    res.json({ ok: true });
  });
  app.post("/api/societies/:id/follow", requireUser, (req, res) => {
    if (!societies.some((s) => s.id === req.params.id))
      return res.status(404).json({ error: "Society not found." });
    const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid follow action." });
    if (parsed.data.active)
      db.prepare("INSERT OR IGNORE INTO follows VALUES (?, ?)").run(
        res.locals.user.id,
        String(req.params.id),
      );
    else
      db.prepare("DELETE FROM follows WHERE user_id=? AND society_id=?").run(
        res.locals.user.id,
        String(req.params.id),
      );
    res.json({ ok: true });
  });
  app.post("/api/events/:id/feature", requireUser, (req, res) => {
    const event = findEvent(String(req.params.id));
    if (!event) return res.status(404).json({ error: "Event not found." });
    const user: User = res.locals.user;
    if (
      !moderation.isModerator(user) &&
      !user.coordinatorSocietyIds.includes(event.societyId)
    )
      return res.status(403).json({
        error: "Only this society coordinator can change featured content.",
      });
    const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid featured selection." });
    db.prepare(
      "INSERT INTO event_features VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET featured=excluded.featured",
    ).run(event.id, Number(parsed.data.active));
    res.json({ ok: true });
  });

  const photosFor = (eventId: string): AlbumPhoto[] => {
    const event = findEvent(eventId)!;
    const sampleImages = [
      ...new Set([
        event.image,
        "/media/friends.jpg",
        "/media/table.jpg",
        "/media/arts.jpg",
      ]),
    ].slice(0, 3);
    const samples = (event.isSample ? sampleImages : []).map((url, i) => ({
      id: `sample-${eventId}-${i}`,
      eventId,
      url,
      name: `${event.title} ${i + 1}.jpg`,
      uploadedBy: "Society coordinator",
      downloadable: true,
    }));
    const photos = db
      .prepare(
        "SELECT photos.*, users.name AS author FROM photos JOIN users ON users.id=photos.user_id WHERE event_id=? ORDER BY photos.rowid DESC",
      )
      .all(eventId);
    return [
      ...photos.map((p) => ({
        id: String(p.id),
        eventId,
        url: `/uploads/${p.file}`,
        name: String(p.name),
        uploadedBy: String(p.author),
        downloadable: true,
      })),
      ...samples,
    ];
  };
  app.get("/api/events/:id/photos", (req, res) => {
    if (!findEvent(String(req.params.id)))
      return res.status(404).json({ error: "Event not found." });
    res.json(photosFor(String(req.params.id)));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  });
  app.post(
    "/api/events/:id/photos",
    requireUser,
    upload.array("photos", 10),
    (req, res) => {
      if (!findEvent(String(req.params.id)))
        return res.status(404).json({ error: "Event not found." });
      const files = req.files as Express.Multer.File[];
      if (!files?.length)
        return res.status(400).json({ error: "Choose at least one photo." });
      const extensions = files.map((f) => {
        if (
          f.buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        )
          return "png";
        if (f.buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")))
          return "jpg";
        if (
          f.buffer.toString("ascii", 0, 4) === "RIFF" &&
          f.buffer.toString("ascii", 8, 12) === "WEBP"
        )
          return "webp";
        return null;
      });
      if (extensions.some((e) => !e))
        return res
          .status(400)
          .json({ error: "Use JPG, PNG, or WebP photos, up to 8 MB each." });
      const written: string[] = [];
      db.exec("BEGIN");
      try {
        files.forEach((file, i) => {
          const id = randomUUID();
          const filename = `${id}.${extensions[i]}`;
          const target = path.join(dataDir, "uploads", filename);
          writeFileSync(target, file.buffer);
          written.push(target);
          db.prepare("INSERT INTO photos VALUES (?, ?, ?, ?, ?)").run(
            id,
            String(req.params.id),
            res.locals.user.id,
            path.basename(file.originalname).slice(0, 180),
            filename,
          );
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        written.forEach((file) => unlinkSync(file));
        throw error;
      }
      res.status(201).json(photosFor(String(req.params.id)));
    },
  );
  app.get("/api/photos/:id/download", (req, res) => {
    const id = String(req.params.id);
    const row = db.prepare("SELECT * FROM photos WHERE id=?").get(id);
    if (row) {
      const event = findEvent(String(row.event_id));
      if (!event || !moderation.canAccess(event, userFor(req)))
        return res.status(404).json({ error: "Photo not found." });
      return res.download(String(row.file), String(row.name), {
        root: path.join(dataDir, "uploads"),
      });
    }
    const sample = allEvents()
      .filter((e) => moderation.canAccess(e, userFor(req)))
      .flatMap((e) => photosFor(e.id))
      .find((p) => p.id === id);
    if (!sample || !sample.url.startsWith("/media/"))
      return res.status(404).json({ error: "Photo not found." });
    res.download(path.join(publicDir, sample.url.slice(1)), sample.name);
  });

  app.use(
    "/uploads",
    (req, res, next) => {
      const file = req.path.slice(1);
      const row = db
        .prepare("SELECT event_id FROM photos WHERE file=?")
        .get(file);
      const event = row ? findEvent(String(row.event_id)) : null;
      if (!event || !moderation.canAccess(event, userFor(req)))
        return res.status(404).json({ error: "Photo not found." });
      next();
    },
    express.static(path.join(dataDir, "uploads"), { dotfiles: "deny" }),
  );
  app.use("/media", express.static(path.join(publicDir, "media")));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof multer.MulterError)
        return res
          .status(400)
          .json({ error: "Upload up to 10 photos, each under 8 MB." });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Invalid request." });
      console.error(error);
      res
        .status(500)
        .json({ error: "Something went wrong. Please try again." });
    },
  );
  return { app, db };
}
