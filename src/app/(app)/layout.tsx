import { Suspense } from "react";
import { AmbientGlow } from "@/components/layout/ambient-glow";
import { FloatingActions } from "@/components/layout/floating-actions";
import { AppHeader, AppHeaderFallback } from "@/components/layout/app-header";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Toaster } from "@/components/ui/toaster";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Toaster>
      <a
        href="#contenu"
        className="sr-only z-[70] rounded-full bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Aller au contenu
      </a>
      <AmbientGlow />
      <Suspense fallback={<AppHeaderFallback />}>
        <AppHeader
          userSlot={
            <Suspense fallback={<span className="block h-10 w-10" />}>
              <UserMenu />
            </Suspense>
          }
        />
      </Suspense>
      <main id="contenu" className="mx-auto w-full max-w-[84rem] flex-1 overflow-x-clip px-4 pb-32 pt-24 sm:px-5 sm:pt-32 xl:pb-24 xl:pt-40">
        {children}
      </main>
      <FloatingActions />
      <Suspense fallback={null}>
        <MobileNav
          accountSlot={
            <Suspense fallback={null}>
              <UserMenu variant="mobile" />
            </Suspense>
          }
        />
      </Suspense>
    </Toaster>
  );
}
