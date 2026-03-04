import { mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Readable } from 'node:stream';
import express, { type Application } from 'express';

export interface AssetStore {
  /** Store an asset and return its serving URL path. */
  put(key: string, data: Buffer): Promise<string>;
  /** Get the URL path for a stored asset. */
  getUrl(key: string): string;
  /** Retrieve an asset as a readable stream. */
  getStream(key: string): Promise<Readable>;
  /** Delete all assets for a given prefix (e.g. courseId/versionId). */
  deletePrefix(prefix: string): Promise<void>;
  /** Mount asset-serving middleware on an Express app (implementation-specific). */
  readonly mount?: (app: Application) => void;
}

/**
 * Create a local filesystem asset store.
 *
 * @param basePath - Absolute path to the asset storage directory on disk
 * @param baseUrl - URL prefix for serving assets (default: "/assets")
 */
export function createLocalAssetStore(basePath: string, baseUrl: string = '/assets'): AssetStore {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  async function put(key: string, data: Buffer): Promise<string> {
    const filePath = join(basePath, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return getUrl(key);
  }

  function getUrl(key: string): string {
    return `${normalizedBaseUrl}/${key}`;
  }

  async function getStream(key: string): Promise<Readable> {
    const filePath = join(basePath, key);
    await stat(filePath); // throws ENOENT if missing
    return createReadStream(filePath);
  }

  async function deletePrefix(prefix: string): Promise<void> {
    const dirPath = join(basePath, prefix);
    await rm(dirPath, { recursive: true, force: true });
  }

  function mount(app: Application): void {
    app.use(normalizedBaseUrl, express.static(basePath));
  }

  return { put, getUrl, getStream, deletePrefix, mount };
}
