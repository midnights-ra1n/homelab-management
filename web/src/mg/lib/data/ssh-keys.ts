// Types of homelab-management's lib/data/ssh-keys.ts + client fetchers.
import { get } from "../client";

export type SshKey = { id: number; name: string; type: string; public_key: string; fingerprint: string; created_at: string };


export const listSshKeys = () => get<SshKey[]>("/api/mg/ssh-keys");
