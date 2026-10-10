import { AmbientGlow } from "@/components/layout/ambient-glow";
import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-16">
      <AmbientGlow />
      <div className="page-enter w-full max-w-md">
        <div className="mb-10 flex justify-center">
          <Logo />
        </div>
        {children}
      </div>
    </div>
  );
}
