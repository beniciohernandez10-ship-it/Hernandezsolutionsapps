import type { MetadataRoute } from "next";

/** Installable web app (PWA). Same backend, same session and permissions as the browser portal. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hernandez Solutions IT Center",
    short_name: "IT Center",
    description: "IT support from Hernandez Solutions.",
    id: "/portal",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    background_color: "#05060a",
    theme_color: "#05060a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
