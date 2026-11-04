/**
 * The smallest MQTT 5 client the Roborock cloud needs (#632): connect over TLS with a username and password, subscribe
 * to one topic, publish one message, wait for the answer, disconnect. No retained state, no reconnects, no QoS 2:
 * each command opens its own short session (a second or two), which suits a function that wakes on a request.
 *
 * Written here rather than pulling in mqtt.js and its dependency tree; the wire format is MQTT 5.0 (OASIS, 2019),
 * the version python-roborock speaks to the same broker (aiomqtt, ProtocolVersion.V5). TLS certificates are checked.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { connect as tlsConnect } from "node:tls";
import type { Duplex } from "node:stream";

export interface MqttOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  clientId: string;
  /** Open the socket (tests pass a fake broker). Default: TLS to host:port with certificate checks. */
  open?: (host: string, port: number) => Duplex;
  timeoutMs?: number;
}

export class MqttError extends Error {
  constructor(readonly code: "connect" | "unauthorized" | "subscribe" | "timeout" | "closed") {
    super(`mqtt ${code}`);
    this.name = "MqttError";
  }
}

/* ── Encoding ── */

export function varint(n: number): Buffer {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

const u16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const utf8 = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u16(b.length), b]);
};
const packet = (type: number, body: Buffer) => Buffer.concat([Buffer.from([type]), varint(body.length), body]);

export function connectPacket(o: Pick<MqttOptions, "clientId" | "username" | "password">, keepAlive = 30): Buffer {
  // Protocol name, level 5, flags: username + password + clean start; keep alive; no properties.
  const head = Buffer.concat([utf8("MQTT"), Buffer.from([5, 0xc2]), u16(keepAlive), varint(0)]);
  return packet(0x10, Buffer.concat([head, utf8(o.clientId), utf8(o.username), utf8(o.password)]));
}

export const subscribePacket = (id: number, topic: string) => packet(0x82, Buffer.concat([u16(id), varint(0), utf8(topic), Buffer.from([0])]));
export const publishPacket = (topic: string, payload: Buffer) => packet(0x30, Buffer.concat([utf8(topic), varint(0), payload]));
export const disconnectPacket = () => Buffer.from([0xe0, 0x00]);

/* ── Decoding ── */

export interface Packet {
  type: number;
  flags: number;
  body: Buffer;
}

/** Whole packets from the front of a buffer, and what is left over. */
export function readPackets(buf: Buffer): { packets: Packet[]; rest: Buffer } {
  const packets: Packet[] = [];
  let i = 0;
  for (;;) {
    if (buf.length - i < 2) break;
    let len = 0;
    let mult = 1;
    let j = i + 1;
    let done = false;
    for (let k = 0; k < 4 && j < buf.length; k++, j++) {
      const b = buf[j]!;
      len += (b & 0x7f) * mult;
      mult *= 128;
      if (!(b & 0x80)) {
        done = true;
        j++;
        break;
      }
    }
    if (!done || buf.length - j < len) break;
    packets.push({ type: buf[i]! >> 4, flags: buf[i]! & 0x0f, body: buf.subarray(j, j + len) });
    i = j + len;
  }
  return { packets, rest: buf.subarray(i) };
}

/** Reads a variable byte integer at `at`: its value and the next offset. */
function readVarint(b: Buffer, at: number): [number, number] {
  let n = 0;
  let mult = 1;
  for (let k = 0; k < 4; k++) {
    const byte = b[at++] ?? 0;
    n += (byte & 0x7f) * mult;
    mult *= 128;
    if (!(byte & 0x80)) break;
  }
  return [n, at];
}

/** A PUBLISH packet's topic and payload (QoS 0 or 1). */
export function readPublish(p: Packet): { topic: string; payload: Buffer; id: number | null } {
  const tlen = p.body.readUInt16BE(0);
  const topic = p.body.subarray(2, 2 + tlen).toString("utf8");
  let at = 2 + tlen;
  const qos = (p.flags >> 1) & 3;
  let id: number | null = null;
  if (qos > 0) {
    id = p.body.readUInt16BE(at);
    at += 2;
  }
  const [plen, next] = readVarint(p.body, at);
  return { topic, payload: p.body.subarray(next + plen), id };
}

/* ── One short session ── */

/**
 * Connects, subscribes to `listen`, publishes `payload` to `send`, and resolves with the first message on `listen`
 * that `match` accepts (or rejects on timeout). Always disconnects.
 */
export async function requestOnce(o: MqttOptions, send: string, listen: string, payload: Buffer, match: (msg: Buffer) => unknown): Promise<unknown> {
  const socket = o.open ? o.open(o.host, o.port) : tlsConnect({ host: o.host, port: o.port, servername: o.host, rejectUnauthorized: true });
  const timeoutMs = o.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let stage: "connecting" | "subscribing" | "waiting" = "connecting";
    let settled = false;
    const finish = (err: MqttError | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (!socket.destroyed) socket.end(disconnectPacket());
      } catch {
        /* closing anyway */
      }
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new MqttError("timeout")), timeoutMs);
    socket.on("error", () => finish(new MqttError(stage === "connecting" ? "connect" : "closed")));
    socket.on("close", () => finish(new MqttError("closed")));
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const { packets, rest } = readPackets(buf);
      buf = Buffer.from(rest);
      for (const p of packets) {
        if (p.type === 2) {
          // CONNACK: session present, reason code.
          const rc = p.body[1] ?? 0xff;
          if (rc !== 0) return finish(new MqttError(rc === 0x86 || rc === 0x87 || rc === 4 || rc === 5 ? "unauthorized" : "connect"));
          stage = "subscribing";
          socket.write(subscribePacket(1, listen));
        } else if (p.type === 9) {
          // SUBACK: packet id, properties, then one reason code per topic.
          const [plen, at] = readVarint(p.body, 2);
          const rc = p.body[at + plen] ?? 0xff;
          if (rc > 2) return finish(new MqttError("subscribe"));
          stage = "waiting";
          socket.write(publishPacket(send, payload));
        } else if (p.type === 3) {
          const msg = readPublish(p);
          if (msg.id !== null) socket.write(Buffer.from([0x40, 0x02, (msg.id >> 8) & 0xff, msg.id & 0xff]));
          if (msg.topic !== listen) continue;
          let got: unknown;
          try {
            got = match(msg.payload);
          } catch {
            got = undefined;
          }
          if (got !== undefined) return finish(null, got);
        }
      }
    });
    const start = () => socket.write(connectPacket(o));
    if (o.open) start();
    else socket.once("secureConnect", start);
  });
}
