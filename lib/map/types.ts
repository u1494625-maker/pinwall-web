export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type MapViewport = {
  lat: number;
  lng: number;
  zoom: number;
  /**
   * Geographic bounds at save time — drives the Home "Maps" tab's spatial filter.
   * Optional because a couple of producers (e.g. "zoom into this area" from a
   * cluster feed) only know a center/zoom to seed Map's next initial camera with;
   * MapPage always overwrites this with real bounds immediately once it mounts.
   */
  bounds?: MapBounds;
};

export type MapClusterItemRef = {
  postId: number;
  mediaId: number | null;
};

export type MapCluster = {
  id: number;
  latitude: number;
  longitude: number;
  /** Count of map items (pins) bundled into this cluster — NOT deduped by
   *  post. Two located photos of the same post legitimately count as two:
   *  a cluster groups map items, not unique posts. */
  itemCount: number;
  items: MapClusterItemRef[];
  /** Deduped unique post ids among this cluster's items — used only by the
   *  cluster-feed link, which shows one card per post regardless of how many
   *  of that post's items are bundled into this cluster. */
  postIds: number[];
  expansionZoom: number;
};
