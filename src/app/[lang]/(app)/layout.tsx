import { Suspense } from "react";
import { AppSidebar, AppSidebarFallback } from "@/components/layout/app-sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { Toaster } from "@/components/ui/toaster";
import { AlertStrip } from "@/components/alert-banner";
import { TimeZoneSync } from "@/features/settings/time-zone";
import { getTimeZone } from "@/lib/data/settings";
import { getT } from "@/i18n/server";
import { connection } from "next/server";

async function TimeZone() {
  await connection();
  return <TimeZoneSync tz={getTimeZone()} />;
}

/** Coque Midnights Classic : [sidebar | contenu] (.mm-app), barre basse sous 640 px. */
export default async function AppLayout({ children }: LayoutProps<"/[lang]">) {
  const tr = await getT();
  return (
    <Toaster>
      <Suspense fallback={null}>
        <TimeZone />
      </Suspense>
      <a
        href="#contenu"
        className="mm-btn mm-btn--primary sr-only z-[70] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {tr("Aller au contenu")}
      </a>
      <div className="mm-app" data-mobile-nav="bottom">
        <Suspense fallback={<AppSidebarFallback />}>
          <AppSidebar
            userSlot={
              <Suspense fallback={<span className="block h-12" />}>
                <UserMenu />
              </Suspense>
            }
          />
        </Suspense>
        <div className="mm-app__main">
          <main id="contenu" className="mm-page flex-1 overflow-x-clip">
            <Suspense fallback={null}>
              <AlertStrip />
            </Suspense>
            {children}
          </main>
        </div>
        <Suspense fallback={null}>
          <MobileNav
            accountSlot={
              <Suspense fallback={null}>
                <UserMenu variant="mobile" />
              </Suspense>
            }
          />
        </Suspense>
      </div>
      <CommandPalette />
    </Toaster>
  );
}
