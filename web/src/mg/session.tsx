import { createContext, use } from "react";

/** Signed-in user and server facts, known once /api/auth/state has answered. */
export type Session = { username: string; version: string; monitoringUrl: string };
export const SessionContext = createContext<Session>({ username: "", version: "dev", monitoringUrl: "" });
export const useSession = () => use(SessionContext);
