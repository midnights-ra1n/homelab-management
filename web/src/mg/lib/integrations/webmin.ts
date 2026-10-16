
export type WebminSystem = {
  hostname: string;
  os: string;
  kernel: string;
  uptime: number | null;
  load: [number, number, number] | null;
  cpus: number | null;
  memTotal: number | null;
  memUsed: number | null;
  diskTotal: number | null;
  diskUsed: number | null;
  webminVersion: string;
  webminService: string;
  updates: number | null;
  rebootRequired: boolean;
};

export type WebminInstance = {
  web: { up: boolean; status?: number; ms: number };
  ssh: boolean;
  system?: WebminSystem;
  sshError?: string;
};
