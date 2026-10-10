import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: {
    default: "Homelab Management",
    template: "%s · Homelab Management",
  },
  description:
    "Inventaire, IPAM, déploiements, monitoring et gestion multi-nœuds Proxmox de ton homelab.",
  applicationName: "Homelab",
  appleWebApp: { capable: true, title: "Homelab", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#191e27" },
    { media: "(prefers-color-scheme: light)", color: "#e4e8ef" },
  ],
};

// Applique le thème mémorisé avant le premier rendu (évite le flash).
const themeScript = `try{var t=localStorage.getItem("hm-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
