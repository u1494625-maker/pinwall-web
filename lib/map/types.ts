export type MapViewport = {
  lat: number;
  lng: number;
  zoom: number;
};

export type MapCluster = {
  id: number;
  latitude: number;
  longitude: number;
  postCount: number;
  postIds: number[];
  representativeImageUrl?: string;
  expansionZoom: number;
};
