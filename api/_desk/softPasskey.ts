/**
 * Test support (#132, #330): a software passkey standing in for Nikita's device, imported only by tests. A P-256 key
 * made here, answering exactly as a platform authenticator would (no attestation, user present and verified). Never
 * imported by a function.
 */

import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const b64 = (b: Uint8Array | Buffer | string) => Buffer.from(b).toString("base64url");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

export class SoftPasskey {
  readonly id = new Uint8Array(Array.from({ length: 16 }, (_, i) => i + 1));
  private readonly key: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  counter = 0;
  constructor(private readonly origin = "https://ceo.test") {}

  private clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  /** The answer to navigator.credentials.create(), as the Desk sends it. */
  create(options: { challenge: string; rp: { id: string } }) {
    const jwk = this.key.publicKey.export({ format: "jwk" });
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([sha(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLen, this.id, cose]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]) as never);
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: "public-key",
      response: { clientDataJSON: b64(this.clientData("webauthn.create", options.challenge)), attestationObject: b64(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  /** The answer to navigator.credentials.get(), as the Desk sends it. */
  get(options: { challenge: string; rpId: string }, flags = 0x05) {
    this.counter += 1;
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha(options.rpId), Buffer.from([flags]), count]);
    const clientData = this.clientData("webauthn.get", options.challenge);
    const signature = sign("sha256", Buffer.concat([authData, sha(clientData)]), this.key.privateKey);
    return { id: b64(this.id), rawId: b64(this.id), type: "public-key", response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) }, clientExtensionResults: {} };
  }
}
