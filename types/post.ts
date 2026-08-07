export type PostType = "image" | "video" | "text";

export type Post = {
  id: number;
  postType: PostType;
  /** Null for text posts. Holds an image URL for image posts, a video URL for video posts. */
  image: string | null;
  imageAlt: string | null;
  imageAspect: string | null;
  /** Optional — text posts may be published without one. */
  title: string | null;
  caption: string;
  tags: string[];
  author: string;
  rating: number;
  ratingCount: string;
  showOnMap: boolean;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  userId?: string;
  createdAt?: string;
};
