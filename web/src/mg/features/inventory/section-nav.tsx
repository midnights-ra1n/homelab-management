
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";

/** Sommaire collant du formulaire (≥ 1024 px) : ancres vers chaque section, la section visible est mise en avant. */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const tr = useT();
  const [current, setCurrent] = useState(sections[0]?.id);
  const key = sections.map((s) => s.id).join();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setCurrent(top.target.id);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const s of key.split(",")) {
      const el = document.getElementById(s);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key]);

  return (
    <nav aria-label={tr("Sections du formulaire")} className="hidden lg:block">
      <ul className="sticky top-6 grid gap-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={current === s.id ? "location" : undefined}
              className="mm-nav-item h-8 text-[13px] no-underline aria-[current=location]:bg-accent-soft aria-[current=location]:text-h1"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
