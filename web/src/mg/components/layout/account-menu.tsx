
import { ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/actions/auth";
import { ThemeSwitch } from "./theme-switch";
import { useT } from "@/i18n/client";

function Avatar({ username, large = false }: { username: string; large?: boolean }) {
  return <span className={large ? "mm-avatar mm-avatar--lg uppercase" : "mm-avatar uppercase"}>{username.slice(0, 2)}</span>;
}

/** Menu du compte de la charte : Thème en contrôle segmenté, puis Se déconnecter. */
function AccountMenu({ canLogout }: { canLogout: boolean }) {
  const tr = useT();
  return (
    <div className="mm-menu w-full" role="menu">
      <div className="mm-menu__label mm-label-caps">{tr("Thème")}</div>
      <div className="mm-menu__block">
        <ThemeSwitch className="mm-segmented--block" />
      </div>
      {canLogout && (
        <>
          <div className="mm-menu__sep" role="separator" />
          <button type="button" role="menuitem" onClick={logoutAction} className="mm-menu__item mm-menu__item--danger">
            {tr("Se déconnecter")}
          </button>
        </>
      )}
    </div>
  );
}

/** Pied de sidebar : avatar, nom, rôle ; le menu s'ouvre vers le haut. */
export function AccountButton({ username, canLogout }: { username: string; canLogout: boolean }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="mm-account-anchor">
      <button
        type="button"
        className="mm-account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={username}
        aria-label={tr("Compte {username}", { username })}
      >
        <Avatar username={username} />
        <span className="mm-account__text">
          <span className="mm-account__name">{username}</span>
          <span className="mm-account__sub">{tr("Administrateur")}</span>
        </span>
        <ChevronsUpDown size={16} aria-hidden="true" className="mm-account__chev" />
      </button>
      {open && (
        <div className="mm-account-menu">
          <AccountMenu canLogout={canLogout} />
        </div>
      )}
    </div>
  );
}

/** Bloc compte de la feuille « Plus » (mobile). */
export function AccountSheet({ username, canLogout }: { username: string; canLogout: boolean }) {
  const tr = useT();
  return (
    <>
      <div className="flex items-center gap-3 px-3 py-2">
        <Avatar username={username} large />
        <span className="mm-account__text">
          <span className="mm-account__name">{username}</span>
          <span className="mm-account__sub">{tr("Administrateur")}</span>
        </span>
      </div>
      <AccountMenu canLogout={canLogout} />
    </>
  );
}
