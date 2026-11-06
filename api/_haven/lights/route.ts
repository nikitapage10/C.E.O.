/**
 * The Haven's lights, over HTTP (#931). Azure only (azure/src/index.ts), behind the site gate, and a passkey session
 * for everything: no phone key, no room key, no public view. The names come straight from the vendors' apps, and
 * switching a light changes the home, so both stay with Nikita's passkey.
 *
 *   GET  /api/haven/lights                       { vendors, lights, scenes, remotes } (./lights.ts LightsView)
 *   POST /api/haven/lights { op: "set", id, on }  one light or IR remote on or off      → { ok, say }
 *   POST /api/haven/lights { op: "scene", id }    runs one SwitchBot manual scene         → { ok, say }
 *
 * 503 until the keys are set (SWITCHBOT_TOKEN and SWITCHBOT_SECRET, or GOVEE_API_KEY, with HOME_TOKEN_KEY for the
 * ids), 404 for an id it doesn't know, 502 when the vendor refused. Every answer is `private, no-store`.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { requireSession, withCookie, type DeskDeps } from "../../_desk/session.js";
import { LIGHT_ID, type Lights } from "./lights.js";

const BODY_MAX = 1024;

export interface LightsRouteDeps {
  desk: DeskDeps;
  /** The service, or null when no vendor key (or no HOME_TOKEN_KEY) is set here. */
  lights: () => Lights | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

/** GET /api/haven/lights. */
export async function lightsGet(request: Request, deps: LightsRouteDeps): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const send = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (new URL(request.url).search !== "") return send({ error: "bad-request" }, 400);
  const lights = deps.lights();
  if (!lights) return send({ error: "not-set-up" }, 503);
  return send(await lights.view());
}

/** POST /api/haven/lights. */
export async function lightsPost(request: Request, deps: LightsRouteDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const send = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return send({ error: "too-big" }, 413);
  let body: Record<string, unknown>;
  try {
    const got: unknown = JSON.parse(raw);
    body = got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : {};
  } catch {
    return send({ error: "bad-request" }, 400);
  }
  const id = typeof body.id === "string" && LIGHT_ID.test(body.id) ? body.id : null;
  if (!id || (body.op !== "set" && body.op !== "scene") || (body.op === "set" && typeof body.on !== "boolean")) return send({ error: "bad-request" }, 400);
  const lights = deps.lights();
  if (!lights) return send({ error: "not-set-up", say: "The lights aren't set up on this copy yet." }, 503);
  const r = body.op === "set" ? await lights.set(id, body.on as boolean) : await lights.scene(id);
  return send(r, r.ok ? 200 : r.code === "unknown" ? 404 : r.code === "vendor" ? 502 : 503);
}
