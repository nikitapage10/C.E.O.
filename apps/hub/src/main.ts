import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { emptyRelayStatus } from "@ceo/core";
import { blueBubbles, registerWebhook, removeWebhook } from "./bluebubbles.ts";
import { HOST, KEYCHAIN_ITEMS, pathsFor, PORT, readConfig, SITE } from "./config.ts";
import { Engine } from "./engine.ts";
import { macKeychain } from "./keychain.ts";
import { fileLogger } from "./log.ts";
import { listen } from "./server.ts";
import { siteClient } from "./site.ts";
import { fileStore } from "./store.ts";

/**
 * The hub's one file on the Mac (built into relay-hub.mjs, served by the site at /relay/relay-hub.mjs). Its commands,
 * run by launchd (`serve`) and by the `relay` command and the installer (the rest). `serve` writes nothing to stdout:
 * only the allowlisted log lines (./log.ts). The others print short plain words, never a value.
 *
 *   serve           the hub: the webhook listener on 127.0.0.1:7420 and the loops
 *   init            makes the local key if there isn't one
 *   pair            reads a pair code on stdin, trades it at the site for the hub token and send key (Keychain)
 *   webhook         registers the hub's webhook with BlueBubbles
 *   check           whether BlueBubbles answers with the stored password
 *   control <what>  pause | resume | report, to the running hub
 *   wipe-report     sends the site a final "wiped" status, then unpairs there: the token, the list and the requests go
 *   wipe-keys       removes the BlueBubbles webhook and every Relay Keychain item
 */

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function need(item: (typeof KEYCHAIN_ITEMS)[number]): Promise<string> {
  const v = await macKeychain.get(item);
  if (!v) {
    out(`Relay: the Keychain has no ${item} yet. Run the installer again.`);
    process.exit(2);
  }
  return v;
}

async function serve(): Promise<void> {
  const paths = pathsFor();
  const log = fileLogger(paths.logs);
  // No stack trace ever reaches launchd.log (it could hold a fragment of a message): an error class in the log, then
  // a clean exit, and launchd starts the hub again.
  const crash = (e: unknown) => {
    log.error("error", e);
    process.exit(1);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  let config = readConfig(null);
  try {
    config = readConfig(readFileSync(paths.config, "utf8"));
  } catch {
    // No config file: the defaults.
  }
  const [password, token, sendKey, localKey] = await Promise.all([need("bluebubbles-password"), need("hub-token"), need("send-key"), need("local-key")]);
  const site = siteClient(token);
  const engine = new Engine({ store: fileStore(paths.state), bb: blueBubbles(password), site, log, config, sendKey: Buffer.from(sendKey, "base64url"), now: Date.now });
  await listen({
    localKey,
    log,
    onMessage: (m) => engine.onMessage(m),
    control: async (what) => {
      if (what === "pause") engine.pause();
      else if (what === "resume") engine.resume();
      await engine.report(true);
    },
  });
  log.log("hub started");
  engine.sweep();
  await engine.refreshSkipTerms(true);
  await engine.checkMessages();
  engine.setHub(engine.status()?.hub === "paused" ? "paused" : "listening");
  await engine.report(true);

  let busy = false;
  const round = async () => {
    if (busy) return;
    busy = true;
    try {
      await engine.act();
      await engine.work();
      await engine.report();
    } finally {
      busy = false;
    }
  };
  setInterval(() => void round(), 15_000);
  setInterval(() => void engine.checkMessages().then(() => engine.report(true)), 5 * 60_000);
  setInterval(() => {
    engine.sweep();
    void engine.refreshSkipTerms();
  }, 60 * 60_000);
  const stop = () => {
    log.log("hub stopped");
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

async function readStdin(): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of process.stdin) parts.push(c as Buffer);
  return Buffer.concat(parts).toString("utf8").trim();
}

async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  if (cmd !== "serve") {
    // The commands print plain words, never a stack trace.
    const fail = () => {
      out("Relay: something went wrong.");
      process.exit(1);
    };
    process.on("uncaughtException", fail);
    process.on("unhandledRejection", fail);
  }
  if (cmd === "serve") return serve();
  if (cmd === "init") {
    if (!(await macKeychain.get("local-key"))) await macKeychain.set("local-key", randomBytes(32).toString("base64url"));
    return out("Relay: local key ready.");
  }
  if (cmd === "pair") {
    const code = await readStdin();
    const res = await fetch(`${SITE}/api/relay-pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }).catch(() => null);
    const got = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; token?: unknown; sendKey?: unknown; error?: unknown; left?: unknown }) : {};
    if (!res || !got.ok || typeof got.token !== "string" || typeof got.sendKey !== "string") {
      const why = got.error === "wrong-code" ? `That code didn't match (${Number(got.left) || 0} tries left).` : got.error === "no-code" ? "No open pair code: press Pair a Mac on the Desk's Relay page for a new one." : "The site didn't answer.";
      out(`Relay: pairing failed. ${why}`);
      process.exit(3);
    }
    await macKeychain.set("hub-token", got.token);
    await macKeychain.set("send-key", got.sendKey);
    return out("Relay: paired with the Desk.");
  }
  if (cmd === "webhook") {
    const [password, localKey] = await Promise.all([need("bluebubbles-password"), need("local-key")]);
    await registerWebhook(password, `http://${HOST}:${PORT}/bluebubbles?k=${encodeURIComponent(localKey)}`);
    return out("Relay: BlueBubbles webhook registered.");
  }
  if (cmd === "check") {
    const ok = await blueBubbles(await need("bluebubbles-password")).ping();
    out(ok ? "Relay: BlueBubbles answers." : "Relay: BlueBubbles didn't answer with that password. Is it running, with the local connection?");
    process.exit(ok ? 0 : 4);
  }
  if (cmd === "control") {
    const what = argv[1];
    if (what !== "pause" && what !== "resume" && what !== "report") return out("Relay: control pause | resume | report");
    const localKey = await need("local-key");
    const res = await fetch(`http://${HOST}:${PORT}/control?k=${encodeURIComponent(localKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ do: what }) }).catch(() => null);
    out(res?.ok ? `Relay: ${what === "pause" ? "paused" : what === "resume" ? "on" : "reported"}.` : "Relay: the hub isn't running.");
    process.exit(res?.ok ? 0 : 5);
  }
  if (cmd === "wipe-report") {
    const token = await macKeychain.get("hub-token");
    if (!token) return out("Relay: not paired; no status to send.");
    const site = siteClient(token);
    await site.status(emptyRelayStatus(Date.now(), "wiped")).catch(() => false);
    // Then the site forgets this pairing: the token stops working, and the list and the requests go.
    const ok = await site.unpair().catch(() => false);
    return out(ok ? "Relay: the site now shows Relay as wiped, and has forgotten this Mac." : "Relay: couldn't reach the site. Press Unpair on the Desk's Relay page to clear it there.");
  }
  if (cmd === "wipe-keys") {
    const password = await macKeychain.get("bluebubbles-password");
    if (password) await removeWebhook(password).catch(() => undefined);
    for (const item of KEYCHAIN_ITEMS) await macKeychain.remove(item);
    return out("Relay: Keychain items and the BlueBubbles webhook removed.");
  }
  out("Relay hub: serve | init | pair | webhook | check | control | wipe-report | wipe-keys");
}

void main(process.argv.slice(2)).catch(() => {
  out("Relay: something went wrong.");
  process.exit(1);
});
