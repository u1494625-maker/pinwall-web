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

export type MapCluster = {
  id: number;
  latitude: number;
  longitude: number;
  postCount: number;
  postIds: number[];
  expansionZoom: number;
};
