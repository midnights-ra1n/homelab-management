import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Plus, Trash2, Upload } from "../shared/icons";
import { Button, IconButton, cn, inputClass, textareaClass, useToast } from "../ui";
import { blankRow, envProblems, envTabular, mergeEnv, parseEnv, serializeEnv, type EnvDoc, type EnvRow } from "./envFile";

const withBlank = (d: EnvDoc): EnvDoc => (d.rows.length ? d : { ...d, rows: [blankRow()] });
const ROW = "grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_2.25rem] items-center gap-2";

/**
 * Name / Value blocks like Vercel's: a whole .env pasted in a Name field, a file imported or
 * dropped, and a text mode for what blocks cannot hold (values on several lines).
 * onChange gets the file's text, and whether a block is invalid.
 */
export function EnvVars({ initial = "", onChange }: { initial?: string; onChange: (text: string, invalid: boolean) => void }) {
  const toast = useToast();
  const [doc, setDoc] = useState(() => withBlank(parseEnv(initial)));
  const [raw, setRaw] = useState(() => (envTabular(parseEnv(initial)) ? null : initial)); // text mode when not null
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [over, setOver] = useState(false);
  const focusRow = useRef(0);
  const file = useRef<HTMLInputElement>(null);

  const text = raw ?? serializeEnv(doc);
  const problems = raw === null ? envProblems(doc.rows) : new Map<number, string>();
  useEffect(() => onChange(text, problems.size > 0), [text, problems.size]);

  const patch = (id: number, p: Partial<EnvRow>) => setDoc({ ...doc, rows: doc.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRow = () => { const r = blankRow(); focusRow.current = r.id; setDoc({ ...doc, rows: [...doc.rows, r] }); };
  const removeRow = (id: number) => setDoc(withBlank({ ...doc, rows: doc.rows.filter((r) => r.id !== id) }));
  const addText = (t: string) => {
    const add = parseEnv(t);
    if (!envTabular(add)) return toast("Ce .env a des valeurs sur plusieurs lignes : collez-le en mode texte", "error");
    setDoc(withBlank(mergeEnv(doc, add)));
    toast(`${add.rows.length} variable(s) importée(s)`, "success");
  };
  const toggle = () => {
    if (raw === null) return setRaw(text);
    const d = parseEnv(raw);
    if (!envTabular(d)) return toast("Valeurs sur plusieurs lignes ou lignes non reconnues : à garder en mode texte", "error");
    setDoc(withBlank(d));
    setRaw(null);
  };
  const toggleShown = (id: number) => { const s = new Set(shown); if (!s.delete(id)) s.add(id); setShown(s); };

  return (
    <div className={cn("rounded-xl border border-line transition-shadow", over && "ring-2 ring-[var(--mm-accent)]")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={async (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && raw === null) addText(await f.text()); }}>
      <div className="grid gap-2 p-4">
        {raw !== null ? (
          <textarea aria-label="Fichier .env" className={cn(textareaClass, "min-h-64 font-mono text-xs")} spellCheck={false} placeholder="DATABASE_URL=postgres://…" value={raw} onChange={(e) => setRaw(e.target.value)} />
        ) : (
          <>
            <div className={ROW} aria-hidden="true"><span className="mm-field__label">Nom</span><span className="mm-field__label">Valeur</span></div>
            {doc.rows.map((r) => (
              <div key={r.id} className="grid gap-1">
                <div className={ROW}>
                  <input aria-label="Nom" className={cn(inputClass, "font-mono text-xs")} placeholder="NOM" spellCheck={false} autoComplete="off" autoFocus={r.id === focusRow.current}
                    value={r.k} aria-invalid={problems.has(r.id) || undefined} onChange={(e) => patch(r.id, { k: e.target.value.replace(/\s/g, "_") })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.parentElement?.querySelector<HTMLInputElement>("[data-value]")?.focus(); } }}
                    onPaste={(e) => { const t = e.clipboardData.getData("text"); if (parseEnv(t).rows.length) { e.preventDefault(); addText(t); } }} />
                  <div className="relative min-w-0">
                    {/* new-password: otherwise the browser fills in the saved login password */}
                    <input data-value aria-label="Valeur" className={cn(inputClass, "pr-10 font-mono text-xs")} placeholder="valeur" spellCheck={false} autoComplete="new-password"
                      type={shown.has(r.id) ? "text" : "password"} value={r.v} onChange={(e) => patch(r.id, { v: e.target.value, raw: null })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRow(); } }} />
                    <IconButton label={shown.has(r.id) ? "Masquer" : "Afficher"} icon={shown.has(r.id) ? <EyeOff size={14} /> : <Eye size={14} />} className="absolute right-0.5 top-1/2 -translate-y-1/2" onClick={() => toggleShown(r.id)} />
                  </div>
                  <IconButton label="Supprimer" variant="danger-ghost" icon={<Trash2 size={14} />} onClick={() => removeRow(r.id)} />
                </div>
                {problems.has(r.id) && <p className="mm-field__error" role="alert"><span aria-hidden="true">✕</span> {problems.get(r.id)}</p>}
              </div>
            ))}
            <Button variant="ghost" size="sm" icon={<Plus size={14} />} className="justify-self-start" onClick={addRow}>Ajouter une variable</Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        {raw === null && (
          <>
            <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={() => file.current?.click()}>Importer un .env</Button>
            <span className="text-xs text-meta">ou collez-le dans un champ Nom</span>
          </>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={toggle}>{raw === null ? "Mode texte" : "Mode blocs"}</Button>
        <input ref={file} type="file" hidden aria-label="Fichier .env à importer" accept=".env,.txt,text/plain"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) addText(await f.text()); e.target.value = ""; }} />
      </div>
    </div>
  );
}
