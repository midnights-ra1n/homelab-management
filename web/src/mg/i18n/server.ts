import { resolved } from "../lib/resource";
import { tr } from "./translate";

/** Pages ported from server components call use(getT()). */
export const getT = () => resolved(tr);
