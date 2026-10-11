/** Re-monté à chaque navigation : rejoue l'entrée de page de la charte. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
