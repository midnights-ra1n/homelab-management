import { useEffect, useState, type ChangeEvent } from "react";
import { Eye, Play, Square } from "../shared/icons";
import { api } from "../api";
import { Alert, Button, CodeBlock, Field, FIELD_ROW, Segmented, Skeleton, inputClass, textareaClass, useToast } from "../ui";

type Page = Record<string, string>;
/** Past this, the page no longer fits in the helper's payload once encoded. */
const MAX_IMAGE = 150 * 1024;
const COLORS: [string, string, string][] = [["bg", "Fond", "#0b1020"], ["fg", "Texte", "#f2f4fb"], ["accent", "Accent", "#22c55e"]];

/** Pause page of an app: fields rendered by the host (node-app), or free HTML; the same preview as the real page. */
export function PauseEditor({ base, app, paused, blocked, onChanged }: { base: string; app: string; paused: boolean; blocked?: string; onChanged?: () => void }) {
  const toast = useToast();
  const [page, setPage] = useState<Page>();
  const [mode, setMode] = useState<"form" | "html">("form");
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const url = `${base}/node-apps/${app}`;

  useEffect(() => {
    api.get<Page>(`${url}/pause`).then((p) => { setPage(p); if (p.html) setMode("html"); }).catch((e) => setError((e as Error).message));
  }, [url]);
  if (error && !page) return <Alert kind="error" title="Page de pause illisible">{error}</Alert>;
  if (!page) return <Skeleton className="h-64 rounded-2xl" />;

  const body = () => (mode === "html" ? { html: page.html ?? "" } : { ...page, html: "" });
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setPage({ ...page, [k]: e.target.value });
  const image = (k: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_IMAGE) { toast("Image trop lourde : 150 Ko au maximum", "error"); return; }
    const r = new FileReader();
    r.onload = () => setPage({ ...page, [k]: String(r.result) });
    r.readAsDataURL(f);
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setError(undefined);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    setBusy("");
  };
  const show = () => run("preview", async () => setPreview((await api.post<{ html: string }>(`${url}/pause/preview`, body())).html));
  const pause = () => run("pause", async () => {
    await api.put(`${url}/pause`, body());
    toast(paused ? "Page de pause mise à jour" : `${app} est en pause`, "success");
    onChanged?.();
  });
  const resume = () => run("resume", async () => {
    await api.post(`${url}/resume`);
    toast(`${app} est de nouveau en ligne`, "success");
    onChanged?.();
  });

  return (
    <div className="grid gap-5">
      <p className="text-sm text-meta">La page remplace le site sur le port de l'app, pour toutes les adresses, avec le code HTTP 503 : le reverse proxy n'a rien à changer. Les déploiements continuent et partent en ligne à la reprise.</p>
      {error && <Alert kind="error" title="Opération refusée">{error}</Alert>}
      <Segmented label="Mode d'édition" value={mode} onChange={setMode} options={[["form", "Mise en forme"], ["html", "HTML libre"]]} />
      {mode === "html" ? (
        <Field label="Page complète" htmlFor="pz-html" hint="Reprise telle quelle, scripts compris. Images en data: ou sur un autre site.">
          <textarea id="pz-html" className={`${textareaClass} min-h-80 font-mono text-xs`} value={page.html ?? ""} onChange={set("html")} spellCheck={false} placeholder="<!doctype html>…" />
        </Field>
      ) : (
        <>
          <div className={FIELD_ROW}>
            <Field label="Titre" htmlFor="pz-title"><input id="pz-title" className={inputClass} value={page.title ?? ""} onChange={set("title")} placeholder="Site en pause" /></Field>
            <Field label="Retour prévu" htmlFor="pz-reopen" hint="Affiche un compte à rebours"><input id="pz-reopen" type="datetime-local" className={inputClass} value={page.reopen ?? ""} onChange={set("reopen")} /></Field>
          </div>
          <Field label="Message" htmlFor="pz-msg"><textarea id="pz-msg" className={textareaClass} value={page.message ?? ""} onChange={set("message")} placeholder="Nous revenons très vite." /></Field>
          <div className="grid gap-5 sm:grid-cols-4">
            {COLORS.map(([k, label, def]) => (
              <Field key={k} label={label} htmlFor={`pz-${k}`}><input id={`pz-${k}`} type="color" className="h-9 w-full cursor-pointer rounded-lg border border-line bg-field" value={page[k] ?? def} onChange={set(k)} /></Field>
            ))}
            <Field label="Police" htmlFor="pz-font">
              <select id="pz-font" className={inputClass} value={page.font ?? "system"} onChange={set("font")}>
                <option value="system">Sans empattement</option><option value="serif">Avec empattement</option><option value="mono">Machine à écrire</option>
              </select>
            </Field>
          </div>
          <div className={FIELD_ROW}>
            {([["logo", "Logo"], ["background", "Image de fond"]] as const).map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`pz-${k}`} hint="Adresse https://, ou fichier de 150 Ko au maximum">
                <div className="grid gap-2">
                  <input id={`pz-${k}`} className={inputClass} value={page[k]?.startsWith("data:") ? "Image importée" : page[k] ?? ""} readOnly={page[k]?.startsWith("data:")} onChange={set(k)} placeholder="https://…" />
                  <span className="flex items-center gap-2">
                    <input type="file" accept="image/*" aria-label={`Importer : ${label}`} className="min-w-0 flex-1 text-xs text-meta" onChange={image(k)} />
                    {page[k] && <Button size="sm" variant="ghost" onClick={() => setPage({ ...page, [k]: "" })}>Retirer</Button>}
                  </span>
                </div>
              </Field>
            ))}
            <Field label="Texte du bouton" htmlFor="pz-blabel"><input id="pz-blabel" className={inputClass} value={page.button_label ?? ""} onChange={set("button_label")} placeholder="Nous contacter" /></Field>
            <Field label="Lien du bouton" htmlFor="pz-burl"><input id="pz-burl" className={inputClass} value={page.button_url ?? ""} onChange={set("button_url")} placeholder="mailto:contact@exemple.fr" /></Field>
          </div>
          <Field label="CSS supplémentaire" htmlFor="pz-css" hint="Ajouté après le style de la page : h1, p, a, img, main, #reopen.">
            <textarea id="pz-css" className={`${textareaClass} font-mono text-xs`} value={page.css ?? ""} onChange={set("css")} spellCheck={false} />
          </Field>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<Eye size={14} />} loading={busy === "preview"} onClick={show}>Aperçu</Button>
        <Button size="sm" icon={<Square size={14} />} loading={busy === "pause"} disabled={!!blocked} title={blocked} onClick={pause}>{paused ? "Mettre à jour la page" : "Mettre en pause"}</Button>
        {paused && <Button variant="secondary" size="sm" icon={<Play size={14} />} loading={busy === "resume"} disabled={!!blocked} title={blocked} onClick={resume}>Reprendre le site</Button>}
      </div>
      {/* sandbox: the page's scripts and links stay out of the dashboard (no countdown in the preview). */}
      {preview !== undefined && <iframe title="Aperçu de la page de pause" sandbox="" srcDoc={preview} className="h-96 w-full rounded-xl border border-line bg-white" />}
    </div>
  );
}

/** Webhook URL of an app: asked on demand, it is a secret. */
export function GitHook({ base, app, auto }: { base: string; app: string; auto: boolean }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const load = () => api.get<{ url: string }>(`${base}/node-apps/${app}/hook`).then((r) => setUrl(r.url)).catch((e) => setError((e as Error).message));
  return (
    <div className="grid gap-2">
      <p className="mm-label-caps">Déployer à chaque git push</p>
      <p className="text-sm text-meta">
        {auto ? "L'hôte vérifie déjà les nouveaux commits toutes les 2 minutes. Pour déployer dès le push, ajoutez cette adresse aux webhooks du dépôt (événement push, GitHub, GitLab, Gitea ou Forgejo). Le hub doit être joignable depuis la forge."
          : "Le déploiement automatique est désactivé pour cette app : le webhook et la vérification périodique sont sans effet."}
      </p>
      {error && <Alert kind="error" title="Adresse indisponible">{error}</Alert>}
      {url ? <CodeBlock text={url} /> : <span><Button variant="secondary" size="sm" onClick={load}>Afficher l'adresse du webhook</Button></span>}
    </div>
  );
}
