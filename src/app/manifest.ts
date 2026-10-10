import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Homelab Management",
    short_name: "Homelab",
    description: "Inventaire, IPAM, déploiements, monitoring et Proxmox multi-nœuds.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#191e27",
    theme_color: "#191e27",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Applications", url: "/applications", icons: [{ src: "/icons/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Inventaire", url: "/inventaire", icons: [{ src: "/icons/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Déploiements", url: "/deploiements", icons: [{ src: "/icons/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Tâches", url: "/taches", icons: [{ src: "/icons/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
