import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "../globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { I18nProvider } from "@/i18n/client";
import { LOCALES } from "@/i18n/locales";
import { getLocale, getT } from "@/i18n/server";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return {
    title: {
      default: "Homelab Management",
      template: "%s · Homelab Management",
    },
    description: tr("Inventaire, IPAM, déploiements, monitoring et gestion multi-nœuds Proxmox de ton homelab."),
    applicationName: "Homelab",
    appleWebApp: { capable: true, title: "Homelab", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e1519" },
    { media: "(prefers-color-scheme: light)", color: "#f2f6f8" },
  ],
};

// Applique le thème et le style mémorisés avant le premier rendu (évite le flash).
const themeScript = `try{var d=document.documentElement,t=localStorage.getItem("hm-theme");if(t==="dark"||t==="light")d.dataset.theme=t;if(localStorage.getItem("hm-style")==="mint")d.dataset.style="mint"}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/[lang]">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
