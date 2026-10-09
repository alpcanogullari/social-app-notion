import type { CampusEvent, Society } from "@vybe/shared";

export const societies: Omit<Society, "following">[] = [
  {
    id: "community",
    name: "Campus Community",
    initials: "VC",
    color: "#d8e8c5",
    category: "Social",
    members: 0,
    description:
      "Open events hosted by people on campus. Meet up, share an interest, and make a plan together.",
  },
  {
    id: "music",
    name: "Music Society",
    initials: "MS",
    color: "#bce1c2",
    category: "Music",
    members: 1240,
    description:
      "Live sessions, loud nights, and a place for every kind of music lover. Come listen, play, or find your next bandmate.",
  },
  {
    id: "arts",
    name: "Arts Collective",
    initials: "AC",
    color: "#f1c4b8",
    category: "Arts",
    members: 860,
    description:
      "A community of makers and curious minds. Sketch walks, exhibitions, and creative evenings. All abilities welcome.",
  },
  {
    id: "outdoors",
    name: "Adventure Society",
    initials: "AS",
    color: "#c7d9ed",
    category: "Outdoors",
    members: 735,
    description:
      "Fresh air and good company. Weekend walks, mountain trails, and adventures beyond campus.",
  },
  {
    id: "food",
    name: "Food & Friends",
    initials: "FF",
    color: "#f2df9d",
    category: "Food",
    members: 510,
    description:
      "Discover the city one bite at a time. Shared tables, new recipes, and a warm welcome.",
  },
  {
    id: "social",
    name: "Campus Connect",
    initials: "CC",
    color: "#dbc9e5",
    category: "Social",
    members: 1890,
    description:
      "Meet someone new. Low-pressure socials, games nights, and a community that makes campus feel like home.",
  },
];

function date(days: number, hour: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
}

export const events: Omit<CampusEvent, "liked" | "saved" | "going">[] = [
  {
    id: "after-hours",
    title: "After Hours: Live on campus",
    societyId: "music",
    category: "Music",
    location: "The Grand Social, Dublin",
    lat: 53.3475,
    lng: -6.2635,
    startsAt: date(1, 19),
    price: "EUR 5",
    image: "/media/live.jpg",
    kind: "upcoming",
    featured: true,
    likes: 248,
    goingCount: 86,
    description:
      "Three student bands. One very good night. Join us for an evening of live music, new faces, and a few songs you will be humming all week. Doors at 7pm; music starts at 7:30pm.",
  },
  {
    id: "creative-evening",
    title: "A little art, a lot of good company",
    societyId: "arts",
    category: "Arts",
    location: "Arts Building, Trinity College",
    lat: 53.3432,
    lng: -6.2546,
    startsAt: date(2, 17),
    price: "Free",
    image: "/media/arts.jpg",
    kind: "upcoming",
    featured: true,
    likes: 129,
    goingCount: 34,
    description:
      "Bring a sketchbook or borrow one of ours. A relaxed creative evening with music, supplies, and plenty of room to try something new. No experience needed.",
  },
  {
    id: "wicklow",
    title: "Take the scenic route",
    societyId: "outdoors",
    category: "Outdoors",
    location: "Campanile, Trinity College",
    lat: 53.3438,
    lng: -6.2547,
    startsAt: date(3, 9),
    price: "EUR 8",
    image: "/media/hike.jpg",
    kind: "upcoming",
    featured: false,
    likes: 176,
    goingCount: 42,
    description:
      "A day in the Wicklow hills with the Adventure Society. We meet at the Campanile before taking the bus together. Bring walking shoes, a rain jacket, water, and lunch.",
  },
  {
    id: "shared-table",
    title: "Good food. Better people.",
    societyId: "food",
    category: "Food",
    location: "Dublin 2, South William Street",
    lat: 53.3417,
    lng: -6.2628,
    startsAt: date(4, 18),
    price: "EUR 10",
    image: "/media/table.jpg",
    kind: "upcoming",
    featured: false,
    likes: 94,
    goingCount: 28,
    description:
      "Our monthly shared table is back. Meet fellow food lovers over a relaxed meal. Vegetarian options are available; please tell the coordinator about any dietary requirements.",
  },
  {
    id: "welcome-night",
    title: "The night we all became friends",
    societyId: "social",
    category: "Social",
    location: "The Pavilion, Trinity College",
    lat: 53.3435,
    lng: -6.2506,
    startsAt: date(-3, 18),
    price: "Free",
    image: "/media/friends.jpg",
    kind: "highlight",
    featured: true,
    likes: 312,
    goingCount: 120,
    description:
      "A few moments from our welcome night. Thanks to everyone who turned up, joined a game, and made someone feel at home. Find your photos in the shared album.",
  },
];
