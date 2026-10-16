/* next/link for the SPA: client-side navigation through the history API. */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { navigate } from "../../ui";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
  scroll?: boolean;
  replace?: boolean;
};

export default function Link({ href, prefetch: _p, scroll = true, replace, children, ...rest }: Props) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (rest.target === "_blank" || /^[a-z]+:/i.test(href) || href.startsWith("/api/")) return;
        e.preventDefault();
        if (replace) {
          history.replaceState(null, "", href);
          window.dispatchEvent(new PopStateEvent("popstate"));
        } else if (scroll) navigate(href);
        else {
          history.pushState(null, "", href);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      }}
    >
      {children}
    </a>
  );
}
