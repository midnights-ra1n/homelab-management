import { Logo } from "@/components/layout/logo";
import { LanguageSwitch } from "@/components/layout/theme-switch";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <div className="mb-10 flex justify-center">
          <Logo />
        </div>
        {children}
        <div className="mt-8 flex justify-center">
          <LanguageSwitch />
        </div>
      </div>
    </div>
  );
}
