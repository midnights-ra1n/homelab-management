// Types of homelab-management's lib/data/backup.ts + client fetchers.

export type Backup = {
  app: "homelab-management";
  version: 1;
  exported_at: string;
  secrets: boolean;
  tables: Record<string, Record<string, unknown>[]>;
  files: Record<string, string>;
};
