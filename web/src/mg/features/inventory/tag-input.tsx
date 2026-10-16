
import { X } from "lucide-react";
import { useId, useState } from "react";
import { Field } from "@/components/ui/form";
import { useT } from "@/i18n/client";

const clean = (t: string) => t.trim().toLowerCase().slice(0, 40);

/** Tags en puces, avec suggestions des tags existants (datalist) ; valeur envoyée « a, b, c ». */
export function TagInput({ name, label, defaultValue = [], suggestions, className }: { name: string; label: string; defaultValue?: string[]; suggestions: string[]; className?: string }) {
  const tr = useT();
  const listId = useId();
  const [tags, setTags] = useState(defaultValue);
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const next = raw.split(",").map(clean).filter((t) => t && !tags.includes(t));
    if (next.length) setTags([...tags, ...new Set(next)]);
    setDraft("");
  };

  return (
    <Field label={label} name={name} className={className} hint={tr("Entrée ou virgule pour valider un tag")}>
      {(p) => (
        <div className="field flex min-h-9 flex-wrap items-center gap-1.5 rounded-[18px] px-2 py-1 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--mm-accent-soft)]">
          <input type="hidden" name={name} value={tags.join(", ")} />
          {tags.map((t) => (
            <span key={t} className="mm-badge mm-badge--accent gap-1 pr-1 font-mono">
              {t}
              <button
                type="button"
                onClick={() => setTags(tags.filter((x) => x !== t))}
                aria-label={tr("Retirer le tag {tag}", { tag: t })}
                className="grid size-4 place-items-center rounded-full hover:bg-[var(--mm-selection)]"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            id={p.id}
            aria-describedby={p["aria-describedby"]}
            list={listId}
            value={draft}
            placeholder={tags.length ? "" : "prod, dns, critique"}
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value;
              // Choix dans la liste de suggestions (pas de inputType) ou virgule tapée : on valide.
              if (v.includes(",") || (!(e.nativeEvent as InputEvent).inputType && suggestions.includes(clean(v)))) add(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && tags.length) setTags(tags.slice(0, -1));
            }}
            onBlur={() => draft.trim() && add(draft)}
            className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base text-h2 outline-none placeholder:text-meta sm:text-sm"
          />
          <datalist id={listId}>
            {suggestions
              .filter((s) => !tags.includes(s))
              .map((s) => (
                <option key={s} value={s} />
              ))}
          </datalist>
        </div>
      )}
    </Field>
  );
}
