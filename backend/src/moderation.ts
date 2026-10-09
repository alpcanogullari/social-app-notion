import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import type { DatabaseSync } from "node:sqlite";
import type { CampusEvent, User } from "@vybe/shared";
import { z } from "zod";
import { societies } from "./seed.js";

const roleSchema = z.enum([
  "normal",
  "event_creator",
  "society_leader",
  "moderator",
]);
const ids = z
  .array(z.string().min(1))
  .max(500)
  .refine((values) => new Set(values).size === values.length);
const preferencesSchema = z
  .object({
    societyIds: ids.nullable(),
    interests: z
      .array(z.enum(["Music", "Arts", "Outdoors", "Food", "Social"]))
      .max(5)
      .nullable(),
    eventIds: ids.nullable(),
    hiddenEventIds: ids,
  })
  .strict();
const defaultPreferences = {
  societyIds: null,
  interests: null,
  eventIds: null,
  hiddenEventIds: [],
};
const policySchema = z
  .object({
    visibility: z.enum(["public", "members", "private"]),
    allowedUserIds: ids,
  })
  .strict();
export type EventPolicy = z.infer<typeof policySchema>;
export type ManagedUser = User & {
  roles: z.infer<typeof roleSchema>[];
  membershipSocietyIds: string[];
  eventPreferences: z.infer<typeof preferencesSchema>;
};
export type AccessEvent = Pick<CampusEvent, "id" | "societyId" | "category"> & {
  ownerId?: string;
};

export function createModeration(db: DatabaseSync, openModeratorMode: boolean) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (user_id TEXT REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY(user_id, role));
    CREATE TABLE IF NOT EXISTS role_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS memberships (user_id TEXT REFERENCES users(id), society_id TEXT NOT NULL, PRIMARY KEY(user_id, society_id));
    CREATE TABLE IF NOT EXISTS event_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_policies (event_id TEXT PRIMARY KEY, settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS moderation_audit (id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const transaction = (work: () => void) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const profile = (id: string): ManagedUser | null => {
    const row = db
      .prepare("SELECT id, name, email FROM users WHERE id=?")
      .get(id);
    if (!row) return null;
    const leaders = db
      .prepare(
        "SELECT society_id FROM coordinator_roles WHERE user_id=? ORDER BY society_id",
      )
      .all(id)
      .map((r) => String(r.society_id));
    const configured = db
      .prepare("SELECT user_id FROM role_profiles WHERE user_id=?")
      .get(id);
    const roles = configured
      ? db
          .prepare("SELECT role FROM user_roles WHERE user_id=? ORDER BY role")
          .all(id)
          .map((r) => roleSchema.parse(r.role))
      : (["normal", "event_creator"] as ManagedUser["roles"]);
    if (leaders.length && !roles.includes("society_leader"))
      roles.push("society_leader");
    if (!roles.length) roles.push("normal");
    const settings = db
      .prepare("SELECT settings FROM event_preferences WHERE user_id=?")
      .get(id);
    const members = db
      .prepare(
        "SELECT society_id FROM memberships WHERE user_id=? ORDER BY society_id",
      )
      .all(id)
      .map((r) => String(r.society_id));
    return {
      id,
      name: String(row.name),
      email: String(row.email),
      roles,
      coordinatorSocietyIds: leaders,
      membershipSocietyIds: [...new Set([...members, ...leaders])].sort(),
      eventPreferences: settings
        ? preferencesSchema.parse(JSON.parse(String(settings.settings)))
        : { ...defaultPreferences },
    };
  };
  const isModerator = (user: User | null) =>
    Boolean(user && profile(user.id)?.roles.includes("moderator"));
  const policy = (eventId: string): EventPolicy => {
    const row = db
      .prepare("SELECT settings FROM event_policies WHERE event_id=?")
      .get(eventId);
    return row
      ? policySchema.parse(JSON.parse(String(row.settings)))
      : { visibility: "public", allowedUserIds: [] };
  };
  const canAccess = (event: AccessEvent, user: User | null) => {
    const viewer = user ? profile(user.id) : null;
    if (viewer?.roles.includes("moderator")) return true;
    if (
      viewer &&
      (event.ownerId === viewer.id ||
        viewer.coordinatorSocietyIds.includes(event.societyId))
    )
      return true;
    const rules = policy(event.id);
    if (viewer && rules.allowedUserIds.includes(viewer.id)) return true;
    if (rules.visibility === "public") return true;
    return (
      rules.visibility === "members" &&
      Boolean(viewer?.membershipSocietyIds.includes(event.societyId))
    );
  };
  const inFeed = (event: AccessEvent, user: User | null) => {
    if (!canAccess(event, user)) return false;
    const prefs = user ? profile(user.id)?.eventPreferences : null;
    return (
      !prefs ||
      (!prefs.hiddenEventIds.includes(event.id) &&
        (prefs.societyIds === null ||
          prefs.societyIds.includes(event.societyId)) &&
        (prefs.interests === null ||
          prefs.interests.includes(event.category)) &&
        (prefs.eventIds === null || prefs.eventIds.includes(event.id)))
    );
  };
  const canHost = (user: User, societyId: string) => {
    const p = profile(user.id)!;
    return (
      p.roles.includes("moderator") ||
      p.coordinatorSocietyIds.includes(societyId) ||
      (societyId === "community" && p.roles.includes("event_creator"))
    );
  };
  const canManage = (event: AccessEvent, user: User) => {
    const p = profile(user.id)!;
    return (
      p.roles.includes("moderator") ||
      p.coordinatorSocietyIds.includes(event.societyId) ||
      (event.ownerId === user.id && p.roles.includes("event_creator"))
    );
  };
  const audit = (
    actor: User | null,
    action: string,
    target: string,
    details: unknown,
  ) => {
    db.prepare(
      "INSERT INTO moderation_audit (actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      actor?.id ?? null,
      action,
      target,
      JSON.stringify(details),
      new Date().toISOString(),
    );
  };
  const validSocieties = (values: string[]) =>
    values.every((id) => societies.some((s) => s.id === id));
  const router = (context: {
    userFor: (req: Request) => User | null;
    allEvents: () => AccessEvent[];
    eventsFor: (user: User | null, filtered?: boolean) => unknown[];
    startSession: (res: Response, name: string) => ManagedUser;
  }) => {
    const route = Router();
    const guard: RequestHandler = (req, res, next) => {
      if (!openModeratorMode && !isModerator(context.userFor(req)))
        return res.status(403).json({ error: "Moderator access is required." });
      next();
    };
    route.use(guard);
    route.get("/", (req, res) =>
      res.json({
        openModeratorMode,
        actor: context.userFor(req),
        roles: roleSchema.options,
        societies,
        warning: openModeratorMode
          ? "Demo mode: anyone can change any account or event access."
          : null,
      }),
    );
    route.post("/session", (req, res) => {
      const parsed = z
        .object({ name: z.string().trim().min(2).max(60) })
        .strict()
        .safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "Provide a name of 2-60 characters." });
      const existing = context.userFor(req);
      const user = existing
        ? profile(existing.id)!
        : context.startSession(res, parsed.data.name);
      audit(existing, "demo_session", user.id, {});
      res.status(existing ? 200 : 201).json({ user, openModeratorMode });
    });
    route.get("/users", (_req, res) =>
      res.json({
        users: db
          .prepare("SELECT id FROM users ORDER BY rowid")
          .all()
          .map((r) => profile(String(r.id))),
      }),
    );
    route.get("/users/:id", (req, res) => {
      const user = profile(String(req.params.id));
      if (!user) return res.status(404).json({ error: "User not found." });
      res.json({ user });
    });
    route.patch("/users/:id", (req, res) => {
      const user = profile(String(req.params.id));
      if (!user) return res.status(404).json({ error: "User not found." });
      const parsed = z
        .object({
          roles: z
            .array(roleSchema)
            .min(1)
            .max(4)
            .refine((v) => new Set(v).size === v.length)
            .optional(),
          leaderSocietyIds: ids.optional(),
          membershipSocietyIds: ids.optional(),
          eventPreferences: preferencesSchema.optional(),
        })
        .strict()
        .safeParse(req.body);
      if (!parsed.success || !Object.keys(parsed.data).length)
        return res.status(400).json({
          error:
            "Provide valid roles, memberships, leadership, or complete event preferences.",
        });
      const patch = parsed.data;
      const leaders = patch.leaderSocietyIds ?? user.coordinatorSocietyIds;
      const members = patch.membershipSocietyIds ?? user.membershipSocietyIds;
      const roles = patch.roles ?? user.roles;
      const knownEvents = new Set(context.allEvents().map((e) => e.id));
      const prefs = patch.eventPreferences;
      if (
        !validSocieties([
          ...leaders,
          ...members,
          ...(prefs?.societyIds ?? []),
        ]) ||
        (prefs &&
          [...(prefs.eventIds ?? []), ...prefs.hiddenEventIds].some(
            (id) => !knownEvents.has(id),
          ))
      )
        return res.status(400).json({ error: "Unknown society or event ID." });
      // Leadership is scoped to societies, not an unscoped global privilege.
      if (
        patch.roles &&
        roles.includes("society_leader") !== leaders.length > 0
      )
        return res.status(400).json({
          error:
            "The society_leader role requires leaderSocietyIds; clear both to remove leadership.",
        });
      transaction(() => {
        db.prepare("INSERT OR IGNORE INTO role_profiles VALUES (?)").run(
          user.id,
        );
        db.prepare("DELETE FROM user_roles WHERE user_id=?").run(user.id);
        for (const role of roles.filter((r) => r !== "society_leader"))
          db.prepare("INSERT INTO user_roles VALUES (?, ?)").run(user.id, role);
        db.prepare("DELETE FROM coordinator_roles WHERE user_id=?").run(
          user.id,
        );
        for (const society of leaders)
          db.prepare("INSERT INTO coordinator_roles VALUES (?, ?)").run(
            user.id,
            society,
          );
        db.prepare("DELETE FROM memberships WHERE user_id=?").run(user.id);
        for (const society of new Set([...members, ...leaders]))
          db.prepare("INSERT INTO memberships VALUES (?, ?)").run(
            user.id,
            society,
          );
        if (prefs)
          db.prepare(
            "INSERT INTO event_preferences VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings",
          ).run(user.id, JSON.stringify(prefs));
        audit(context.userFor(req), "update_user_access", user.id, patch);
      });
      res.json({ user: profile(user.id) });
    });
    route.get("/users/:id/events", (req, res) => {
      const user = profile(String(req.params.id));
      if (!user) return res.status(404).json({ error: "User not found." });
      res.json({ user, events: context.eventsFor(user) });
    });
    route.get("/events", (req, res) =>
      res.json({
        events: context.eventsFor(context.userFor(req), false).map((e) => ({
          ...(e as object),
          access: policy((e as AccessEvent).id),
        })),
      }),
    );
    route.put("/events/:id/access", (req, res) => {
      const id = String(req.params.id);
      if (!context.allEvents().some((e) => e.id === id))
        return res.status(404).json({ error: "Event not found." });
      const parsed = policySchema.safeParse(req.body);
      if (
        !parsed.success ||
        parsed.data.allowedUserIds.some((id) => !profile(id))
      )
        return res.status(400).json({
          error:
            "Provide public, members, or private visibility and known allowedUserIds.",
        });
      transaction(() => {
        db.prepare(
          "INSERT INTO event_policies VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET settings=excluded.settings",
        ).run(id, JSON.stringify(parsed.data));
        audit(context.userFor(req), "update_event_access", id, parsed.data);
      });
      res.json({ eventId: id, access: policy(id) });
    });
    route.get("/audit", (_req, res) =>
      res.json({
        entries: db
          .prepare("SELECT * FROM moderation_audit ORDER BY id DESC LIMIT 200")
          .all()
          .map((r) => ({ ...r, details: JSON.parse(String(r.details)) })),
      }),
    );
    return route;
  };
  return {
    profile,
    policy,
    canAccess,
    inFeed,
    canHost,
    canManage,
    isModerator,
    router,
    audit,
  };
}
