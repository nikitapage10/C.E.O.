import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readWebhook, type Inbound } from "./bluebubbles.ts";
import { HOST, PORT } from "./config.ts";
import type { Logger } from "./log.ts";

/**
 * The hub's only listener (docs/RELAY-PRIVACY.md, "Access"): 127.0.0.1:7420, never 0.0.0.0, and nothing for the site
 * or a browser. Two paths, both needing the local key (the Keychain's local-key, made at install) in `?k=`:
 *
 *   POST /bluebubbles?k=…   BlueBubbles' new-message webhook (it can't send headers, so the key rides in the URL
 *                           BlueBubbles was given; both live only on this Mac)
 *   POST /control?k=…       the `relay` command: { do: "pause" | "resume" | "report" }
 *
 * Anything else, or a wrong key, is a bare 404 or 401 with no body. No CORS headers at all, so no web page can read an
 * answer, and a request that carries an Origin is refused outright.
 */

export const MAX_BODY = 256 * 1024;

const same = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

export interface ServerDeps {
  localKey: string;
  log: Logger;
  onMessage(m: Inbound): Promise<void>;
  control(what: "pause" | "resume" | "report"): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

export function handler(deps: ServerDeps) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const end = (code: number) => {
      res.writeHead(code, { "Cache-Control": "no-store", "Content-Length": "0" });
      res.end();
    };
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    if (req.method !== "POST" || (url.pathname !== "/bluebubbles" && url.pathname !== "/control")) return end(404);
    if (req.headers.origin || !same(url.searchParams.get("k") ?? "", deps.localKey) || [...url.searchParams.keys()].length !== 1) {
      deps.log.log("request refused");
      return end(401);
    }
    const raw = await readBody(req);
    if (raw === null) return end(413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return end(400);
    }
    if (url.pathname === "/control") {
      const what = (body as { do?: unknown })?.do;
      if (what !== "pause" && what !== "resume" && what !== "report") return end(400);
      await deps.control(what).catch((e) => deps.log.error("error", e));
      return end(204);
    }
    const m = readWebhook(body);
    deps.log.log("webhook in", { message: m ? 1 : 0 });
    if (m) await deps.onMessage(m).catch((e) => deps.log.error("error", e));
    return end(204);
  };
}

/** Listens on 127.0.0.1:7420 only. */
export function listen(deps: ServerDeps, port = PORT): Promise<Server> {
  const server = createServer({ requestTimeout: 30_000 }, (req, res) => void handler(deps)(req, res));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve(server));
  });
}
