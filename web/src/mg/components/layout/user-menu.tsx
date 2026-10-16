import { useSession } from "@/session";
import { AccountButton, AccountSheet } from "./account-menu";

export function UserMenu({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const { username } = useSession();
  return variant === "sidebar" ? <AccountButton username={username} canLogout /> : <AccountSheet username={username} canLogout />;
}
