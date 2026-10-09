import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { CampusEvent } from "@vybe/shared";
import { apiUrl } from "./api";

function Focus({ event }: { event?: CampusEvent }) {
  const map = useMap();
  useEffect(() => {
    if (event) map.flyTo([event.lat, event.lng], 16, { duration: 0.6 });
  }, [map, event]);
  return null;
}

export default function EventMap({
  events,
  selectedId,
  onSelect,
  onOpen,
}: {
  events: CampusEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (event: CampusEvent) => void;
}) {
  return (
    <div className="map-layout">
      <div className="map-panel" aria-label="Interactive event map">
        <MapContainer
          center={[53.3439, -6.257]}
          zoom={15}
          scrollWheelZoom
          className="campus-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Focus event={events.find((e) => e.id === selectedId)} />
          {events.map((event, i) => (
            <Marker
              key={event.id}
              position={[event.lat, event.lng]}
              icon={divIcon({
                className: "map-marker",
                html: `<span class="${event.id === selectedId ? "selected" : ""}">${i + 1}</span>`,
                iconSize: [36, 36],
                iconAnchor: [18, 36],
              })}
              eventHandlers={{ click: () => onSelect(event.id) }}
            >
              <Popup>
                <strong>{event.title}</strong>
                <p>{event.location}</p>
                <button className="popup-action" onClick={() => onOpen(event)}>
                  View event <ArrowUpRight size={14} />
                </button>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className="map-events">
        <h2>
          On the map <span>{events.length}</span>
        </h2>
        {events.length === 0 && (
          <p className="muted">No events match these interests.</p>
        )}
        {events.map((event, i) => (
          <button
            key={event.id}
            className={`map-event ${selectedId === event.id ? "active" : ""}`}
            onClick={() => onSelect(event.id)}
          >
            <img src={apiUrl(event.image)} alt="" />
            <span className="map-event-copy">
              <small>{event.category}</small>
              <strong>{event.title}</strong>
              <span>
                <MapPin size={12} />
                {event.location}
              </span>
            </span>
            <b className="map-number">{i + 1}</b>
          </button>
        ))}
        {selectedId && events.some((e) => e.id === selectedId) && (
          <button
            className="primary full"
            onClick={() => onOpen(events.find((e) => e.id === selectedId)!)}
          >
            View selected event <ArrowUpRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
