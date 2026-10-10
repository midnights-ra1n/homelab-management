import { Box, Container, Cpu, HardDrive, Monitor, Router, Server, type LucideProps } from "lucide-react";
import { ASSET_KIND_META, TONE_VAR, type AssetKind } from "@/lib/constants";
import { cn } from "@/lib/utils";

const ICONS: Record<AssetKind, React.ComponentType<LucideProps>> = {
  physical: Server,
  vm: Monitor,
  lxc: Box,
  docker: Container,
  network: Router,
  other: HardDrive,
};

export function KindIcon({ kind, size = 16, className }: { kind: AssetKind | string; size?: number; className?: string }) {
  const Icon = ICONS[kind as AssetKind] ?? Cpu;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/** Pastille carrée teintée avec l'icône du type. */
export function KindAvatar({ kind, size = "md" }: { kind: AssetKind; size?: "sm" | "md" | "lg" }) {
  const tone = TONE_VAR[ASSET_KIND_META[kind]?.tone ?? "muted"];
  const dim = { sm: "h-8 w-8 rounded-lg", md: "h-10 w-10 rounded-xl", lg: "h-14 w-14 rounded-2xl" }[size];
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center border", dim)}
      style={{
        color: tone,
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${tone} 30%, transparent)`,
      }}
      title={ASSET_KIND_META[kind]?.label}
    >
      <KindIcon kind={kind} size={size === "lg" ? 26 : size === "md" ? 18 : 15} />
    </span>
  );
}
