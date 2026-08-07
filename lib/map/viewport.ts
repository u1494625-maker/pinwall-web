import type { MapViewport } from "./types";

const VIEWPORT_KEY = "pinwall_map_viewport";

export function saveMapViewport(viewport: MapViewport) {
  try {
    window.sessionStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
  } catch {
    // Ignore storage failures (e.g. private browsing quota).
  }
}

export function readMapViewport(): MapViewport | null {
  try {
    const raw = window.sessionStorage.getItem(VIEWPORT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lat === "number" &&
      typeof parsed?.lng === "number" &&
      typeof parsed?.zoom === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
