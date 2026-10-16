import { tr } from "./translate";
export { usePathname } from "../next/navigation";

export function useT() {
  return tr;
}

export function Tr({ children }: { children: string }) {
  return tr(children);
}
