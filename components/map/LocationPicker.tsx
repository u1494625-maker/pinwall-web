"use client";

import { useEffect, useRef, useState } from "react";
import type * as LType from "leaflet";

type LatLng = { lat: number; lng: number };

type LocationPickerProps = {
  value: LatLng | null;
  onChange: (coords: LatLng) => void;
};

const WORLD_CENTER: LatLng = { lat: 20, lng: 0 };
const WORLD_ZOOM = 2;
const PICKED_ZOOM = 15;

// The composer's own in-progress location pick — deliberately distinct from
// the map/cluster post markers, which are untouched by this.
const PIN_ICON_SIZE = 32;
const PIN_HTML = `
  <div style="width:${PIN_ICON_SIZE}px;height:${PIN_ICON_SIZE}px;display:flex;align-items:center;justify-content:center;font-size:26px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35));">📍</div>
`;

export default function LocationPicker({ value, onChange }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markerRef = useRef<LType.Marker | null>(null);
  const onChangeRef = useRef(onChange);

  const [locateError, setLocateError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  function placeMarker(coords: LatLng, panTo: boolean) {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet) return;

    if (!markerRef.current) {
      const icon = leaflet.divIcon({
        html: PIN_HTML,
        className: "",
        iconSize: [PIN_ICON_SIZE, PIN_ICON_SIZE],
        iconAnchor: [PIN_ICON_SIZE / 2, PIN_ICON_SIZE / 2],
      });
      markerRef.current = leaflet
        .marker([coords.lat, coords.lng], { icon, draggable: true })
        .addTo(map);
      markerRef.current.on("dragend", () => {
        const latlng = markerRef.current?.getLatLng();
        if (latlng) onChangeRef.current({ lat: latlng.lat, lng: latlng.lng });
      });
    } else {
      markerRef.current.setLatLng([coords.lat, coords.lng]);
    }

    if (panTo) {
      map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), PICKED_ZOOM));
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      leafletRef.current = leaflet;

      const initialCenter = value ?? WORLD_CENTER;
      const initialZoom = value ? PICKED_ZOOM : WORLD_ZOOM;

      const map = leaflet.map(containerRef.current, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: initialZoom,
        zoomControl: true,
      });

      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        })
        .addTo(map);

      map.on("click", (event: LType.LeafletMouseEvent) => {
        const coords = { lat: event.latlng.lat, lng: event.latlng.lng };
        placeMarker(coords, false);
        onChangeRef.current(coords);
      });

      mapRef.current = map;

      if (value) {
        placeMarker(value, false);
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (cancelled || !mapRef.current) return;
            mapRef.current.setView([position.coords.latitude, position.coords.longitude], PICKED_ZOOM);
          },
          () => {
            // Ignore — the picker just stays on the neutral world view.
          },
          { timeout: 8000 },
        );
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Mount once; `value` changes from user interaction are reflected via placeMarker calls,
    // not by re-initializing the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useCurrentLocation() {
    setLocateError(null);
    if (!navigator.geolocation) {
      setLocateError("Location isn't available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        placeMarker(coords, true);
        onChangeRef.current(coords);
      },
      () => setLocateError("Couldn't get your location. Tap the map to choose a spot instead."),
      { timeout: 8000 },
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200">
      <div ref={containerRef} className="h-56 w-full" />
      <div className="flex items-center justify-between gap-2 bg-white px-3 py-2">
        <p className="text-[11px] text-stone-500">
          {value ? "Drag the pin to fine-tune." : "Tap the map to drop a pin."}
        </p>
        <button
          type="button"
          onClick={useCurrentLocation}
          className="shrink-0 rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-700 hover:bg-kavanaka-aqua/10"
        >
          Use current location
        </button>
      </div>
      {locateError ? <p className="bg-white px-3 pb-2 text-[11px] text-red-600">{locateError}</p> : null}
    </div>
  );
}
