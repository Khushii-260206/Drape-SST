import type { MetadataRoute } from "next";

// GitHub Pages serves the site under /<repo>, so every URL in the manifest needs that prefix.
const base = process.env.PAGES_BASE_PATH || "";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Drape — your AI stylist",
    short_name: "Drape",
    description: "Your wardrobe, styled. Outfits for any occasion from the clothes you already own.",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#fff9f2",
    theme_color: "#fff9f2",
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
