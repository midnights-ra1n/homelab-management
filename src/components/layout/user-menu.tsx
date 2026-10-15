import { AUTH_DISABLED, requireUser } from "@/lib/auth";
import { AccountButton, AccountSheet } from "./account-menu";

export async function UserMenu({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const user = await requireUser();
  return variant === "sidebar" ? (
    <AccountButton username={user.username} canLogout={!AUTH_DISABLED} />
  ) : (
    <AccountSheet username={user.username} canLogout={!AUTH_DISABLED} />
  );
}
