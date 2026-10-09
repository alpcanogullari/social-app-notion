import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  Check,
  ChevronRight,
  Compass,
  Heart,
  Images,
  LoaderCircle,
  LogOut,
  MapPin,
  Search,
  Share2,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api, apiUrl } from "./api";
import EventMap from "./EventMap";
import type {
  AlbumPhoto,
  Bootstrap,
  CampusEvent,
  Interest,
  Society,
  View,
} from "@vybe/shared";

const interests: Interest[] = ["Music", "Arts", "Outdoors", "Food", "Social"];
const navigation: { id: View; label: string; icon: typeof Compass }[] = [
  { id: "feed", label: "Discover", icon: Compass },
  { id: "map", label: "Event map", icon: MapPin },
  { id: "societies", label: "Societies", icon: Users },
  { id: "albums", label: "Photo albums", icon: Images },
  { id: "saved", label: "Saved events", icon: Bookmark },
];
const dateLabel = (event: CampusEvent) =>
  new Date(event.startsAt).toLocaleDateString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Dublin",
  });
const timeLabel = (event: CampusEvent) =>
  new Date(event.startsAt).toLocaleTimeString("en-IE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Dublin",
  });

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          title="Close"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Avatar({
  society,
  small = false,
}: {
  society: Society;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{ background: society.color }}
    >
      {society.initials}
    </span>
  );
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>("feed");
  const [query, setQuery] = useState("");
  const [interest, setInterest] = useState<Interest | "All">("All");
  const [feedMode, setFeedMode] = useState<"all" | "upcoming" | "highlight">(
    "all",
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSocietyId, setSelectedSocietyId] = useState<string | null>(
    null,
  );
  const [mapSelection, setMapSelection] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [albumId, setAlbumId] = useState("welcome-night");
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumError, setAlbumError] = useState("");
  const [photo, setPhoto] = useState<AlbumPhoto | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    const next = await api<Bootstrap>("/api/bootstrap");
    setData(next);
    setLoadError("");
  }, []);
  useEffect(() => {
    refresh().catch((e) => setLoadError(e.message));
  }, [refresh]);
  useEffect(() => {
    const focus = () => refresh().catch(() => {});
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (view !== "albums") return;
    let active = true;
    setAlbumLoading(true);
    setAlbumError("");
    setPhotos([]);
    api<AlbumPhoto[]>(`/api/events/${albumId}/photos`)
      .then((p) => {
        if (active) setPhotos(p);
      })
      .catch((e) => {
        if (active) setAlbumError(e.message);
      })
      .finally(() => {
        if (active) setAlbumLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view, albumId]);

  const openAuth = () => {
    setAuthError("");
    setAuthOpen(true);
  };
  const act = async (
    key: string,
    task: () => Promise<unknown>,
    message?: string,
  ) => {
    if (!data?.user) {
      openAuth();
      return;
    }
    if (pending.includes(key)) return;
    setPending((p) => [...p, key]);
    try {
      await task();
      await refresh();
      if (message) setToast(message);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPending((p) => p.filter((k) => k !== key));
    }
  };
  const eventAction = (event: CampusEvent, kind: "like" | "save" | "going") => {
    const active = !(kind === "like"
      ? event.liked
      : kind === "save"
        ? event.saved
        : event.going);
    return act(
      `${event.id}-${kind}`,
      () =>
        api(`/api/events/${event.id}/actions`, {
          method: "POST",
          body: JSON.stringify({ kind, active }),
        }),
      kind === "going"
        ? active
          ? "You're on the list!"
          : "RSVP cancelled."
        : undefined,
    );
  };
  const follow = (society: Society) =>
    act(`${society.id}-follow`, () =>
      api(`/api/societies/${society.id}/follow`, {
        method: "POST",
        body: JSON.stringify({ active: !society.following }),
      }),
    );
  const featureEvent = (event: CampusEvent, active: boolean) =>
    act(
      `${event.id}-feature`,
      async () => {
        const setFeatured = (value: boolean) =>
          setData((current) =>
            current
              ? {
                  ...current,
                  events: current.events.map((e) =>
                    e.id === event.id ? { ...e, featured: value } : e,
                  ),
                }
              : current,
          );
        setFeatured(active);
        try {
          await api(`/api/events/${event.id}/feature`, {
            method: "POST",
            body: JSON.stringify({ active }),
          });
        } catch (error) {
          setFeatured(event.featured);
          throw error;
        }
      },
      active
        ? "Added to coordinator picks."
        : "Removed from coordinator picks.",
    );
  const navigate = (next: View) => {
    setView(next);
    setQuery("");
    setInterest("All");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openAlbum = (id: string) => {
    setSelectedEventId(null);
    setSelectedSocietyId(null);
    setAlbumId(id);
    navigate("albums");
  };
  const share = async (event: CampusEvent) => {
    const url = `${window.location.origin}/?event=${event.id}`;
    try {
      if (navigator.share) await navigator.share({ title: event.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setToast("Event link copied.");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setToast("Unable to share. Please copy the address from your browser.");
    }
  };
  useEffect(() => {
    if (!data) return;
    const id = new URLSearchParams(window.location.search).get("event");
    if (id && data.events.some((e) => e.id === id)) setSelectedEventId(id);
  }, [Boolean(data)]);

  async function authenticate(form: HTMLFormElement) {
    const fields = new FormData(form);
    setBusy(true);
    setAuthError("");
    try {
      await api(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(fields)),
      });
      await refresh();
      setAuthOpen(false);
      setToast(authMode === "register" ? "Welcome to VYBE." : "Welcome back.");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (!data?.user) {
      openAuth();
      return;
    }
    if (
      files.length > 10 ||
      Array.from(files).some((f) => f.size > 8 * 1024 * 1024)
    ) {
      setToast("Choose up to 10 photos, under 8 MB each.");
      return;
    }
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("photos", f));
    setUploading(true);
    try {
      const next = await api<AlbumPhoto[]>(`/api/events/${albumId}/photos`, {
        method: "POST",
        body: form,
      });
      setPhotos(next);
      setToast("Your photos are in the album.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  if (!data)
    return (
      <div className="startup">
        <div className="wordmark">
          VYBE<span>.</span>
        </div>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <button
              className="primary"
              onClick={() => refresh().catch((e) => setLoadError(e.message))}
            >
              Try again
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" aria-label="Loading VYBE" />
        )}
      </div>
    );

  const societyFor = (event: CampusEvent) =>
    data.societies.find((s) => s.id === event.societyId)!;
  const matches = (event: CampusEvent) =>
    (interest === "All" || event.category === interest) &&
    `${event.title} ${event.location} ${societyFor(event).name}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const filtered = data.events
    .filter(matches)
    .filter((e) => view !== "saved" || e.saved)
    .filter(
      (e) => view !== "feed" || feedMode === "all" || e.kind === feedMode,
    );
  const upcoming = data.events.filter((e) => e.kind === "upcoming");
  const event = data.events.find((e) => e.id === selectedEventId);
  const society = data.societies.find((s) => s.id === selectedSocietyId);
  const album = data.events.find((e) => e.id === albumId)!;
  const headings = {
    feed: "For you",
    map: "Explore the map",
    societies: "Find your community",
    albums: "The moments after",
    saved: "Saved events",
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <button
          className="wordmark brand-button"
          aria-label="VYBE home"
          onClick={() => navigate("feed")}
        >
          VYBE<span>.</span>
        </button>
        <div className="campus-label">
          <span className="status-dot" />
          Dublin campus
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "saved" && data.events.some((e) => e.saved) && (
                <span className="nav-count">
                  {data.events.filter((e) => e.saved).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sparkles size={18} />
            <span>
              A little more
              <br />
              <strong>life on campus.</strong>
            </span>
          </div>
          <small className="sample-label">Sample events · Dublin</small>
          {data.user ? (
            <div className="profile">
              <span className="user-avatar">
                {data.user.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{data.user.name}</strong>
                <small>My campus</small>
              </span>
              <button
                className="icon-button"
                title="Sign out"
                aria-label="Sign out"
                onClick={async () => {
                  try {
                    await api("/api/auth/logout", { method: "POST" });
                    await refresh();
                  } catch {
                    setToast("Could not sign out. Try again.");
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <button className="primary full" onClick={openAuth}>
              Join VYBE <ArrowUpRight size={17} />
            </button>
          )}
        </div>
      </aside>

      <main className={`main view-${view}`}>
        <header className="topbar">
          <span className="topbar-label">YOUR CAMPUS, CONNECTED</span>
          <label className="search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                view === "societies"
                  ? "Search societies"
                  : "Search events, societies..."
              }
              aria-label="Search"
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </label>
          {!data.user && (
            <button
              className="topbar-signin"
              onClick={() => {
                setAuthMode("login");
                openAuth();
              }}
            >
              Sign in <ArrowUpRight size={15} />
            </button>
          )}
        </header>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {view === "feed"
                ? "GOOD PLANS START HERE"
                : view === "map"
                  ? "A LITTLE CLOSER THAN YOU THINK"
                  : view === "societies"
                    ? "YOUR PEOPLE ARE HERE"
                    : view === "albums"
                      ? "FROM THE COMMUNITY"
                      : "KEEP THE GOOD PLANS"}
            </div>
            <h1>
              {headings[view]}
              <span className="heading-dot">.</span>
            </h1>
          </div>
          {view === "feed" && (
            <div className="segmented" aria-label="Feed content">
              <button
                className={feedMode === "all" ? "selected" : ""}
                onClick={() => setFeedMode("all")}
              >
                All vibes
              </button>
              <button
                className={feedMode === "upcoming" ? "selected" : ""}
                onClick={() => setFeedMode("upcoming")}
              >
                Upcoming
              </button>
              <button
                className={feedMode === "highlight" ? "selected" : ""}
                onClick={() => setFeedMode("highlight")}
              >
                Highlights
              </button>
            </div>
          )}
        </div>
        {view !== "albums" && (
          <div className="interest-bar" aria-label="Filter by interest">
            {(["All", ...interests] as const).map((i) => (
              <button
                key={i}
                className={`interest ${interest === i ? "selected" : ""}`}
                aria-pressed={interest === i}
                onClick={() => setInterest(i)}
              >
                {i === "All" && <Sparkles size={14} />}
                {i === "All" ? "All interests" : i}
              </button>
            ))}
          </div>
        )}

        {(view === "feed" || view === "saved") && (
          <div className="feed-layout">
            <section className="feed" aria-label="Event feed">
              {filtered.length === 0 && (
                <div className="empty">
                  <Bookmark size={28} />
                  <h2>
                    {view === "saved"
                      ? "Good plans, kept here."
                      : "No events found."}
                  </h2>
                  <p>
                    {view === "saved"
                      ? "Save an event to come back to it."
                      : "Try a different interest or search."}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      navigate("feed");
                      setFeedMode("all");
                    }}
                  >
                    Explore events <ArrowUpRight size={16} />
                  </button>
                </div>
              )}
              {filtered.map((e) => (
                <article className="reel" key={e.id}>
                  <div className="reel-top">
                    <button
                      className="society-link"
                      onClick={() => setSelectedSocietyId(e.societyId)}
                    >
                      <Avatar society={societyFor(e)} small />
                      <span>
                        <strong>{societyFor(e).name}</strong>
                        <small>
                          {e.kind === "highlight"
                            ? "A look back"
                            : "Something to look forward to"}
                        </small>
                      </span>
                    </button>
                    {e.featured && (
                      <span className="featured">
                        <Sparkles size={12} />
                        Coordinator pick
                      </span>
                    )}
                  </div>
                  <div className="reel-media">
                    <img src={apiUrl(e.image)} alt={e.title} loading="lazy" />
                    <span
                      className={`category-badge category-${e.category.toLowerCase()}`}
                    >
                      {e.category}
                    </span>
                    <button
                      className={`reel-save icon-button ${e.saved ? "is-saved" : ""}`}
                      aria-label={
                        e.saved ? `Unsave ${e.title}` : `Save ${e.title}`
                      }
                      title={e.saved ? "Unsave event" : "Save event"}
                      disabled={pending.includes(`${e.id}-save`)}
                      onClick={() => eventAction(e, "save")}
                    >
                      <Bookmark
                        size={20}
                        fill={e.saved ? "currentColor" : "none"}
                      />
                    </button>
                    <div className="reel-caption">
                      <span className="reel-date">
                        {e.kind === "highlight"
                          ? "THE HIGHLIGHTS"
                          : `${dateLabel(e)} · ${timeLabel(e)}`}
                      </span>
                      <h2>{e.title}</h2>
                      <span className="reel-location">
                        <MapPin size={14} />
                        {e.location}
                      </span>
                      <button
                        className="reel-cta"
                        onClick={() =>
                          e.kind === "highlight"
                            ? openAlbum(e.id)
                            : setSelectedEventId(e.id)
                        }
                      >
                        {e.kind === "highlight"
                          ? "Open the album"
                          : "Get the details"}
                        <ArrowUpRight size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="reel-footer">
                    <div className="reel-actions">
                      <button
                        className={e.liked ? "liked" : ""}
                        title={e.liked ? "Unlike" : "Like"}
                        aria-label={`${e.liked ? "Unlike" : "Like"} ${e.title}`}
                        disabled={pending.includes(`${e.id}-like`)}
                        onClick={() => eventAction(e, "like")}
                      >
                        <Heart
                          size={20}
                          fill={e.liked ? "currentColor" : "none"}
                        />
                        <span>{e.likes}</span>
                      </button>
                      <button
                        title="View event album"
                        aria-label={`Album for ${e.title}`}
                        onClick={() => openAlbum(e.id)}
                      >
                        <Images size={20} />
                      </button>
                      <button
                        title="Share event"
                        aria-label={`Share ${e.title}`}
                        onClick={() => share(e)}
                      >
                        <Share2 size={19} />
                      </button>
                    </div>
                    <span className="going-label">
                      <span className="mini-people">● ● ●</span>
                      <strong>{e.goingCount}</strong>{" "}
                      {e.kind === "highlight" ? "were there" : "going"}
                    </span>
                  </div>
                </article>
              ))}
            </section>
            <aside className="discovery-aside">
              <div className="section-title">
                <h2>Coming up</h2>
                <CalendarDays size={17} />
              </div>
              {upcoming.slice(0, 3).map((e) => (
                <button
                  className="upcoming-row"
                  key={e.id}
                  onClick={() => setSelectedEventId(e.id)}
                >
                  <img src={apiUrl(e.image)} alt="" />
                  <span>
                    <small>{dateLabel(e)}</small>
                    <strong>{e.title}</strong>
                    <span>
                      {e.price} <span className="dot-separator">·</span>{" "}
                      {e.category}
                    </span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
              <div className="aside-divider" />
              <div className="section-title">
                <h2>Meet the societies</h2>
                <Users size={17} />
              </div>
              {data.societies.slice(0, 3).map((s) => (
                <div className="suggested-society" key={s.id}>
                  <button
                    className="society-link"
                    onClick={() => setSelectedSocietyId(s.id)}
                  >
                    <Avatar society={s} small />
                    <span>
                      <strong>{s.name}</strong>
                      <small>{s.members.toLocaleString()} members</small>
                    </span>
                  </button>
                  <button
                    className={`follow-small ${s.following ? "following" : ""}`}
                    onClick={() => follow(s)}
                    disabled={pending.includes(`${s.id}-follow`)}
                  >
                    {s.following ? (
                      <Check size={16} aria-label="Following" />
                    ) : (
                      "Follow"
                    )}
                  </button>
                </div>
              ))}
              <button
                className="text-action"
                onClick={() => navigate("societies")}
              >
                Explore all societies <ArrowUpRight size={15} />
              </button>
              <div className="map-teaser">
                <MapPin size={25} />
                <h3>
                  Your next plan
                  <br />
                  might be around the corner.
                </h3>
                <button className="text-action" onClick={() => navigate("map")}>
                  See the map <ArrowUpRight size={16} />
                </button>
              </div>
              <p className="aside-footnote">
                Made for the moments between lectures.
                <br />
                VYBE · Dublin campus
              </p>
            </aside>
          </div>
        )}

        {view === "map" && (
          <EventMap
            events={filtered.filter((e) => e.kind === "upcoming")}
            selectedId={mapSelection}
            onSelect={setMapSelection}
            onOpen={(e) => setSelectedEventId(e.id)}
          />
        )}

        {view === "societies" && (
          <section className="society-grid" aria-label="Societies">
            {data.societies
              .filter(
                (s) =>
                  (interest === "All" || s.category === interest) &&
                  `${s.name} ${s.description}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((s) => (
                <article className="society-card" key={s.id}>
                  <div className="society-card-heading">
                    <Avatar society={s} />
                    <span className="muted category-text">{s.category}</span>
                  </div>
                  <button
                    className="society-name"
                    onClick={() => setSelectedSocietyId(s.id)}
                  >
                    {s.name}
                    <ArrowUpRight size={18} />
                  </button>
                  <p>{s.description}</p>
                  <div className="society-card-footer">
                    <span>
                      <Users size={14} />
                      {s.members.toLocaleString()} members
                    </span>
                    <button
                      className={s.following ? "secondary" : "primary"}
                      disabled={pending.includes(`${s.id}-follow`)}
                      onClick={() => follow(s)}
                    >
                      {s.following ? <Check size={15} /> : <Users size={15} />}
                      {s.following ? "Following" : "Follow"}
                    </button>
                  </div>
                </article>
              ))}
            {data.societies.filter(
              (s) =>
                (interest === "All" || s.category === interest) &&
                `${s.name} ${s.description}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            ).length === 0 && (
              <div className="empty">
                <Users size={28} />
                <h2>No societies found.</h2>
                <p>Try another search or interest.</p>
              </div>
            )}
          </section>
        )}

        {view === "albums" && (
          <section className="albums">
            <div className="album-toolbar">
              <label className="album-select">
                <Images size={18} />
                <select
                  aria-label="Choose event album"
                  value={albumId}
                  onChange={(e) => setAlbumId(e.target.value)}
                >
                  {data.events
                    .filter(
                      (e) =>
                        `${e.title} ${societyFor(e).name}`
                          .toLowerCase()
                          .includes(query.toLowerCase()) || e.id === albumId,
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={uploading}
                onClick={() => {
                  if (!data.user) openAuth();
                  else uploadRef.current?.click();
                }}
              >
                {uploading ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Upload size={17} />
                )}
                {uploading ? "Uploading..." : "Add photos"}
              </button>
              <input
                className="visually-hidden"
                ref={uploadRef}
                aria-label="Upload event photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => upload(e.target.files)}
              />
            </div>
            <div className="album-info">
              <div>
                <h2>{album.title}</h2>
                <p>
                  {dateLabel(album)} <span className="dot-separator">·</span>{" "}
                  {societyFor(album).name}
                </p>
              </div>
              <span>
                {albumLoading ? "Loading..." : `${photos.length} photos`}
              </span>
            </div>
            {albumError && (
              <p role="alert" className="form-error">
                {albumError}
              </p>
            )}
            {albumLoading ? (
              <div className="empty">
                <LoaderCircle className="spin" />
              </div>
            ) : (
              <div className="photo-grid">
                {photos.map((p) => (
                  <article className="photo-card" key={p.id}>
                    <button
                      className="photo-preview"
                      onClick={() => setPhoto(p)}
                      aria-label={`View ${p.name}`}
                    >
                      <img src={apiUrl(p.url)} alt={p.name} loading="lazy" />
                    </button>
                    <div className="photo-meta">
                      <span>{p.uploadedBy}</span>
                      <a
                        className="icon-button"
                        title="Download photo"
                        aria-label={`Download ${p.name}`}
                        href={apiUrl(`/api/photos/${p.id}/download`)}
                      >
                        <ArrowDownToLine size={17} />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {event && (
        <Modal
          title="The details"
          onClose={() => setSelectedEventId(null)}
          wide
        >
          <img
            className="event-cover"
            src={apiUrl(event.image)}
            alt={event.title}
          />
          <div className="event-detail">
            <div className="detail-tags">
              <span
                className={`category-badge category-${event.category.toLowerCase()}`}
              >
                {event.category}
              </span>
              <span>{event.price}</span>
            </div>
            <h2>{event.title}</h2>
            <button
              className="society-link"
              onClick={() => {
                setSelectedEventId(null);
                setSelectedSocietyId(event.societyId);
              }}
            >
              <Avatar society={societyFor(event)} small />
              <strong>{societyFor(event).name}</strong>
              <ArrowUpRight size={15} />
            </button>
            <div className="event-facts">
              <span>
                <CalendarDays size={18} />
                {dateLabel(event)} · {timeLabel(event)}
              </span>
              <span>
                <MapPin size={18} />
                {event.location}
              </span>
              <span>
                <Users size={18} />
                {event.goingCount}{" "}
                {event.kind === "highlight" ? "attended" : "people going"}
              </span>
            </div>
            <p className="event-description">{event.description}</p>
            {data.user?.coordinatorSocietyIds.includes(event.societyId) && (
              <label className="coordinator-toggle">
                <span>
                  <Sparkles size={17} />
                  Coordinator pick
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={event.featured}
                  disabled={pending.includes(`${event.id}-feature`)}
                  onChange={(e) => featureEvent(event, e.target.checked)}
                />
              </label>
            )}
            <div className="detail-actions">
              {event.kind === "upcoming" ? (
                <button
                  className="primary"
                  disabled={pending.includes(`${event.id}-going`)}
                  onClick={() => eventAction(event, "going")}
                >
                  {event.going ? (
                    <Check size={18} />
                  ) : (
                    <CalendarDays size={18} />
                  )}
                  {event.going ? "You're going" : "I'm going"}
                </button>
              ) : (
                <button className="primary" onClick={() => openAlbum(event.id)}>
                  <Images size={18} />
                  View album
                </button>
              )}
              <button
                className="secondary"
                onClick={() => eventAction(event, "save")}
                disabled={pending.includes(`${event.id}-save`)}
              >
                <Bookmark
                  size={17}
                  fill={event.saved ? "currentColor" : "none"}
                />
                {event.saved ? "Saved" : "Save"}
              </button>
              <button
                className="icon-button"
                title="Share event"
                aria-label="Share event"
                onClick={() => share(event)}
              >
                <Share2 size={18} />
              </button>
            </div>
          </div>
        </Modal>
      )}

      {society && (
        <Modal
          title="Meet the society"
          onClose={() => setSelectedSocietyId(null)}
          wide
        >
          <div className="society-detail">
            <Avatar society={society} />
            <span className="eyebrow">{society.category} · DUBLIN CAMPUS</span>
            <h2>{society.name}</h2>
            <p>{society.description}</p>
            <div className="society-detail-meta">
              <span>
                <Users size={17} />
                {society.members.toLocaleString()} members
              </span>
              <button
                className={society.following ? "secondary" : "primary"}
                disabled={pending.includes(`${society.id}-follow`)}
                onClick={() => follow(society)}
              >
                {society.following ? <Check size={16} /> : <Users size={16} />}
                {society.following ? "Following" : "Follow society"}
              </button>
            </div>
            <h3>What's happening</h3>
            {data.events
              .filter((e) => e.societyId === society.id)
              .map((e) => (
                <button
                  className="upcoming-row"
                  key={e.id}
                  onClick={() => {
                    setSelectedSocietyId(null);
                    setSelectedEventId(e.id);
                  }}
                >
                  <img src={apiUrl(e.image)} alt="" />
                  <span>
                    <small>{dateLabel(e)}</small>
                    <strong>{e.title}</strong>
                    <span>{e.location}</span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
        </Modal>
      )}

      {photo && (
        <Modal title="A moment, kept" onClose={() => setPhoto(null)} wide>
          <img
            className="lightbox-image"
            src={apiUrl(photo.url)}
            alt={photo.name}
          />
          <div className="lightbox-footer">
            <span>Shared by {photo.uploadedBy}</span>
            <a
              className="primary"
              href={apiUrl(`/api/photos/${photo.id}/download`)}
            >
              <ArrowDownToLine size={17} />
              Download
            </a>
          </div>
        </Modal>
      )}

      {authOpen && (
        <Modal
          title={
            authMode === "register" ? "Find your people." : "Welcome back."
          }
          onClose={() => {
            if (!busy) setAuthOpen(false);
          }}
        >
          <div className="auth-content">
            <div className="wordmark auth-brand">
              VYBE<span>.</span>
            </div>
            <div className="segmented auth-tabs">
              <button
                className={authMode === "register" ? "selected" : ""}
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                }}
              >
                Join VYBE
              </button>
              <button
                className={authMode === "login" ? "selected" : ""}
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                }}
              >
                Sign in
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                authenticate(e.currentTarget);
              }}
            >
              {authMode === "register" && (
                <label>
                  Your name
                  <input
                    name="name"
                    placeholder="Alex Murphy"
                    autoComplete="name"
                    minLength={2}
                    maxLength={60}
                    required
                  />
                </label>
              )}
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  placeholder="you@university.ie"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  placeholder="At least 8 characters"
                  autoComplete={
                    authMode === "register"
                      ? "new-password"
                      : "current-password"
                  }
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              {authError && (
                <p className="form-error" role="alert">
                  {authError}
                </p>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
                {busy
                  ? "One moment..."
                  : authMode === "register"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            title="Dismiss"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
