import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kavanaka",
    short_name: "Kavanaka",
    description: "Social enough to share. Useful enough to search.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6f1",
    theme_color: "#b7d916",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
