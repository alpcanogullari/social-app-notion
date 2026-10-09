export type Interest = "Music" | "Arts" | "Outdoors" | "Food" | "Social";
export type View = "feed" | "map" | "societies" | "albums" | "saved";
export interface User {
  id: string;
  name: string;
  email: string;
  coordinatorSocietyIds: string[];
}
export interface Society {
  id: string;
  name: string;
  initials: string;
  color: string;
  category: Interest;
  description: string;
  members: number;
  following: boolean;
}
export interface CampusEvent {
  id: string;
  title: string;
  description: string;
  societyId: string;
  category: Interest;
  location: string;
  lat: number;
  lng: number;
  startsAt: string;
  price: string;
  image: string;
  kind: "upcoming" | "highlight";
  featured: boolean;
  likes: number;
  goingCount: number;
  liked: boolean;
  saved: boolean;
  going: boolean;
}
export interface AlbumPhoto {
  id: string;
  eventId: string;
  url: string;
  name: string;
  uploadedBy: string;
  downloadable: boolean;
}
export interface Bootstrap {
  user: User | null;
  events: CampusEvent[];
  societies: Society[];
}
