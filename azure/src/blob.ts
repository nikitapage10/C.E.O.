/**
 * The blob store on Azure (WORLD_STORE=azureblob, api/_blob.ts): the `ceo-state` container in the Function App's
 * storage account, reached with its managed identity through DefaultAzureCredential. No account key or connection
 * string: the account allows none (infra/resources.bicep). The container is private, so idea pictures stay private
 * and only come back through /api/foundry-image on a signed link, as on Vercel.
 *
 * Settings (set by the Bicep): AZURE_STORAGE_ACCOUNT or AZURE_STORAGE_BLOB_ENDPOINT, and AZURE_STORAGE_CONTAINER
 * (default `ceo-state`).
 */

import { Readable } from "node:stream";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { BlobPreconditionError, type BlobBackend, type PutOptions } from "../../api/_blob.js";

type Env = Record<string, string | undefined>;

export const DEFAULT_CONTAINER = "ceo-state";

/** The account's blob endpoint: the one given, else the account's public one. */
export function blobEndpoint(env: Env): string {
  const given = env.AZURE_STORAGE_BLOB_ENDPOINT?.trim();
  if (given) return given.endsWith("/") ? given : `${given}/`;
  const account = env.AZURE_STORAGE_ACCOUNT?.trim() ?? "";
  if (!/^[a-z0-9]{3,24}$/.test(account)) throw new Error("AZURE_STORAGE_ACCOUNT is not a storage account name");
  return `https://${account}.blob.core.windows.net/`;
}

const statusOf = (e: unknown): number | undefined => (e && typeof e === "object" && "statusCode" in e ? Number((e as { statusCode: unknown }).statusCode) : undefined);

/** A name with a random part before its extension ("a.jpg" → "a-k3j9…x.jpg"), as Vercel Blob's random suffix. */
export function withRandomSuffix(path: string): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 21);
  const m = /^(.*?)(\.[\w]+)?$/.exec(path)!;
  return `${m[1]}-${random}${m[2] ?? ""}`;
}

const toBytes = (body: string | ArrayBuffer | Uint8Array): Uint8Array =>
  typeof body === "string" ? new TextEncoder().encode(body) : body instanceof ArrayBuffer ? new Uint8Array(body) : body;

/** The blob store over one container. */
export function azureBlob(container: ContainerClient): BlobBackend {
  return {
    kind: "azureblob",
    async get(path) {
      try {
        const res = await container.getBlockBlobClient(path).download();
        const body = res.readableStreamBody;
        if (!body) return null;
        return {
          stream: Readable.toWeb(body as Readable) as unknown as ReadableStream<Uint8Array>,
          etag: res.etag ?? "",
          contentType: res.contentType ?? "",
        };
      } catch (e) {
        if (statusOf(e) === 404) return null;
        throw e;
      }
    },
    async etag(path) {
      try {
        return (await container.getBlockBlobClient(path).getProperties()).etag ?? null;
      } catch (e) {
        if (statusOf(e) === 404) return null;
        throw e;
      }
    },
    async put(path, body, opts: PutOptions) {
      const name = opts.addRandomSuffix ? withRandomSuffix(path) : path;
      const bytes = toBytes(body);
      // Vercel Blob's rules: ifMatch writes only over that version; otherwise overwrite only when allowed.
      const conditions = opts.ifMatch ? { ifMatch: opts.ifMatch } : opts.allowOverwrite ? undefined : { ifNoneMatch: "*" };
      try {
        await container.getBlockBlobClient(name).upload(bytes, bytes.byteLength, {
          blobHTTPHeaders: {
            blobContentType: opts.contentType,
            ...(opts.cacheControlMaxAge !== undefined && { blobCacheControl: `private, max-age=${opts.cacheControlMaxAge}` }),
          },
          ...(conditions && { conditions }),
        });
      } catch (e) {
        const status = statusOf(e);
        if (status === 412 || status === 409) throw new BlobPreconditionError(`blob ${status === 412 ? "changed" : "already exists"}`);
        throw e;
      }
      return { pathname: name };
    },
    async del(path) {
      await container.getBlockBlobClient(path).deleteIfExists();
    },
  };
}

/** The backend for these settings, signed in with the Function App's identity. */
export function azureBlobFromEnv(env: Env): BlobBackend {
  const service = new BlobServiceClient(blobEndpoint(env), new DefaultAzureCredential());
  return azureBlob(service.getContainerClient(env.AZURE_STORAGE_CONTAINER?.trim() || DEFAULT_CONTAINER));
}
