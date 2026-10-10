import { AUTH_DISABLED, requireUser } from "@/lib/auth";
import { UserDropdown, UserRow } from "./user-dropdown";

export async function UserMenu({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const user = await requireUser();
  return variant === "desktop" ? (
    <UserDropdown username={user.username} canLogout={!AUTH_DISABLED} />
  ) : (
    <UserRow username={user.username} canLogout={!AUTH_DISABLED} />
  );
}
