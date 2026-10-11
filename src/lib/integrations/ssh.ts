import "server-only";
import crypto from "node:crypto";
import ssh2 from "ssh2";

const { Client } = ssh2; // ssh2 est en CommonJS : pas d'import nommé
import { IntegrationError } from "./http";

export type SshTarget = {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  /** Empreinte attendue (SHA256:…) ; absente = première connexion, acceptée puis renvoyée. */
  hostKey?: string;
};

/** Exécute une commande (lecture seule) et renvoie stdout + l'empreinte de l'hôte. */
export function sshExec(target: SshTarget, command: string, timeoutMs = 15_000): Promise<{ stdout: string; hostKey: string }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let seen = "";
    let settled = false;
    const finish = (err: Error | null, stdout = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      if (err) reject(err);
      else resolve({ stdout, hostKey: seen });
    };
    const timer = setTimeout(() => finish(new IntegrationError("SSH : délai dépassé")), timeoutMs);
    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return finish(new IntegrationError(`SSH : ${err.message}`));
          let out = "";
          stream.on("data", (d: Buffer) => {
            if (out.length < 256_000) out += d.toString("utf8");
          });
          stream.stderr.on("data", () => {});
          stream.on("close", () => finish(null, out));
        });
      })
      .on("error", (err: Error & { level?: string }) => {
        const msg =
          err.level === "client-authentication"
            ? "SSH : authentification refusée (clé publique absente de authorized_keys ?)"
            : err.message.includes("Host denied")
              ? "SSH : empreinte de l'hôte modifiée — possible attaque MITM. Réinitialise l'empreinte si l'hôte a été réinstallé."
              : `SSH : ${err.message}`;
        finish(new IntegrationError(msg));
      })
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        privateKey: target.privateKey,
        readyTimeout: timeoutMs,
        hostVerifier: (key: Buffer) => {
          seen = "SHA256:" + crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          return !target.hostKey || target.hostKey === seen;
        },
      });
  });
}
