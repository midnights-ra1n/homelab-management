import { Suspense, use } from "react";
import { AppSidebar, AppSidebarFallback } from "@/components/layout/app-sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { Toaster } from "@/components/ui/toaster";
import { NotificationsButton } from "@/components/alert-banner";
import { NAV_ITEMS, NAV_TABS } from "@/components/layout/nav-items";
import { usePathname } from "@/i18n/client";
import { PageTabs } from "../../ui";
import { TimeZoneSync } from "@/features/settings/time-zone";
import { getTimeZone } from "@/lib/data/settings";
import { getT } from "@/i18n/server";

function TimeZone() {
  return <TimeZoneSync tz={use(getTimeZone())} />;
}

function SectionTabs() {
  const tr = use(getT());
  return <PageTabs pathname={usePathname()} tabs={NAV_TABS} items={NAV_ITEMS.map((i) => ({ href: i.href, label: tr(i.label) }))} label={tr("Pages de la section")} />;
}

/** Coque Dashboard Of Midnights : [sidebar | contenu] (.mm-app), barre basse sous 640 px. */
export default function AppLayout({ children }: LayoutProps<"/[lang]">) {
  const tr = use(getT());
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
            <SectionTabs />
            {children}
          </main>
        </div>
        <NotificationsButton floating />
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
