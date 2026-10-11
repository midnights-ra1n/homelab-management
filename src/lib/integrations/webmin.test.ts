import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import ssh2, { type Connection } from "ssh2";
import { sshExec } from "./ssh";
import { parseSystem } from "./webmin";

const { Server, utils } = ssh2;

const hostKey = utils.generateKeyPairSync("ed25519");
const clientKey = utils.generateKeyPairSync("ed25519");
const otherKey = utils.generateKeyPairSync("ed25519");
const allowed = utils.parseKey(clientKey.public) as ReturnType<typeof utils.parseKey> & { getPublicSSH(): Buffer };

const OUTPUT = "hostname=lab-01\nos=Debian GNU/Linux 13 (trixie)\nuptime=93784.12\nload=0.50 0.25 0.10\ncpus=4\nmem_total=8000\nmem_used=2000\nwebmin_version=2.402\nwebmin_service=active\nupdates=3\nreboot=1\n";

let server: ssh2.Server;
let port = 0;
before(async () => {
  server = new Server({ hostKeys: [hostKey.private] }, (client: Connection) => {
    client
      .on("authentication", (ctx) => {
        if (ctx.method === "publickey" && ctx.key.data.equals(allowed.getPublicSSH())) return ctx.accept();
        ctx.reject(["publickey"]);
      })
      .on("ready", () => {
        client.on("session", (accept) => {
          accept().on("exec", (acceptExec) => {
            const stream = acceptExec();
            stream.write(OUTPUT);
            stream.exit(0);
            stream.end();
          });
        });
      })
      .on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
after(() => server.close());

const target = (extra: object = {}) => ({ host: "127.0.0.1", port, username: "root", privateKey: clientKey.private, ...extra });

test("SSH : exécution, puis empreinte mémorisée (TOFU) et refus si elle change", async () => {
  const first = await sshExec(target(), "true");
  assert.match(first.hostKey, /^SHA256:/);
  const sys = parseSystem(first.stdout);
  assert.equal(sys.hostname, "lab-01");
  assert.deepEqual(sys.load, [0.5, 0.25, 0.1]);
  assert.equal(sys.updates, 3);
  assert.equal(sys.rebootRequired, true);
  assert.equal(sys.webminVersion, "2.402");

  await sshExec(target({ hostKey: first.hostKey }), "true");
  await assert.rejects(sshExec(target({ hostKey: "SHA256:autre" }), "true"), /MITM/);
});

test("SSH : clé non autorisée refusée", async () => {
  await assert.rejects(sshExec(target({ privateKey: otherKey.private }), "true"), /authentification refusée/);
});

test("parseSystem tolère une sortie incomplète", () => {
  const sys = parseSystem("hostname=x\nload=n/a\n");
  assert.equal(sys.load, null);
  assert.equal(sys.updates, null);
  assert.equal(sys.memTotal, null);
});
