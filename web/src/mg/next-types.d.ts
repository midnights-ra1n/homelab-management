/* Page props as Next.js passed them; the SPA router (../App.tsx) builds them from the URL. */
type PageProps<_Route extends string = string> = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type LayoutProps<_Route extends string = string> = { children: import("react").ReactNode };
