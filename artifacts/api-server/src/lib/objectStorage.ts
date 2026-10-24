import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';
import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';
const localMode = () => process.env.LOCAL_FILE_STORAGE === 'true';
const localRoot = () => path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), '.local-object-storage'));
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: 'json', subject_token_field_name: 'access_token' },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** File-like adapter used only for local development. */
class LocalObjectFile {
  readonly name: string;
  private readonly fullPath: string;
  private readonly metaPath: string;
  constructor(relative: string) {
    const clean = relative.replace(/\\/g, '/').replace(/^\/+/, '');
    this.fullPath = path.resolve(localRoot(), clean);
    if (!this.fullPath.startsWith(localRoot() + path.sep)) throw new Error('Invalid object path');
    this.metaPath = `${this.fullPath}.metadata.json`;
    this.name = clean;
  }
  async exists(): Promise<[boolean]> { return [fs.existsSync(this.fullPath)]; }
  async getMetadata(): Promise<[Record<string, any>]> {
    if (!fs.existsSync(this.fullPath)) throw new ObjectNotFoundError();
    let custom: Record<string, any> = {};
    try { custom = JSON.parse(fs.readFileSync(this.metaPath, 'utf8')); } catch {}
    const stat = fs.statSync(this.fullPath);
    return [{ size: stat.size, contentType: custom.contentType || 'application/pdf', metadata: custom.metadata || {} }];
  }
  async setMetadata(input: any): Promise<void> {
    let old: Record<string, any> = {};
    try { old = JSON.parse(fs.readFileSync(this.metaPath, 'utf8')); } catch {}
    const next = { ...old, ...input, metadata: { ...(old.metadata || {}), ...(input.metadata || {}) } };
    fs.mkdirSync(path.dirname(this.metaPath), { recursive: true });
    fs.writeFileSync(this.metaPath, JSON.stringify(next, null, 2));
  }
  createReadStream(): fs.ReadStream { return fs.createReadStream(this.fullPath); }
  async download(): Promise<[Buffer]> { return [fs.readFileSync(this.fullPath)]; }
  async delete(options?: { ignoreNotFound?: boolean }): Promise<void> {
    if (!fs.existsSync(this.fullPath)) {
      if (options?.ignoreNotFound) return;
      throw new ObjectNotFoundError();
    }
    fs.unlinkSync(this.fullPath);
    try { fs.unlinkSync(this.metaPath); } catch {}
  }
}

function parseObjectPath(input: string): { bucketName: string; objectName: string } {
  const normalized = input.startsWith('/') ? input : `/${input}`;
  const parts = normalized.split('/');
  if (parts.length < 3) throw new Error('Invalid path: must contain at least a bucket name');
  return { bucketName: parts[1], objectName: parts.slice(2).join('/') };
}

export class ObjectStorageService {
  getPublicObjectSearchPaths(): string[] {
    if (localMode()) return [];
    const paths = Array.from(new Set((process.env.PUBLIC_OBJECT_SEARCH_PATHS || '').split(',').map(p => p.trim()).filter(Boolean)));
    if (!paths.length) throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set. Configure object storage.");
    return paths;
  }
  getPrivateObjectDir(): string {
    if (localMode()) return '/local/uploads';
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set. Configure object storage.");
    return dir;
  }
  async searchPublicObject(filePath: string): Promise<File | null> {
    if (localMode()) return null;
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(`${searchPath}/${filePath}`);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }
  async downloadObject(file: File, cacheTtlSec = 3600): Promise<Response> {
    const local = file as unknown as LocalObjectFile;
    const [metadata] = await (localMode() ? local.getMetadata() : file.getMetadata());
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      'Content-Type': (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) headers['Content-Length'] = String(metadata.size);
    return new Response(webStream, { headers });
  }
  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    if (localMode()) return `/api/storage/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(`${this.getPrivateObjectDir()}/uploads/${objectId}`);
    return signObjectURL({ bucketName, objectName, method: 'PUT', ttlSec: 900 });
  }
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) throw new ObjectNotFoundError();
    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) throw new ObjectNotFoundError();
    const entityId = parts.slice(1).join('/');
    if (localMode()) {
      const file = new LocalObjectFile(entityId);
      const [exists] = await file.exists();
      if (!exists) throw new ObjectNotFoundError();
      return file as unknown as File;
    }
    let dir = this.getPrivateObjectDir();
    if (!dir.endsWith('/')) dir += '/';
    const { bucketName, objectName } = parseObjectPath(`${dir}${entityId}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }
  normalizeObjectEntityPath(rawPath: string): string {
    if (localMode()) {
      const match = rawPath.match(/\/api\/storage\/uploads\/([0-9a-f-]{36})/i);
      if (match) return `/objects/uploads/${match[1]}`;
    }
    if (!rawPath.startsWith('https://storage.googleapis.com/')) return rawPath;
    const url = new URL(rawPath);
    const raw = url.pathname;
    let dir = this.getPrivateObjectDir();
    if (!dir.endsWith('/')) dir += '/';
    if (!raw.startsWith(dir)) return raw;
    return `/objects/${raw.slice(dir.length)}`;
  }
  async trySetObjectEntityAclPolicy(rawPath: string, policy: ObjectAclPolicy): Promise<string> {
    const normalized = this.normalizeObjectEntityPath(rawPath);
    if (!normalized.startsWith('/')) return normalized;
    const file = await this.getObjectEntityFile(normalized);
    await setObjectAclPolicy(file, policy);
    return normalized;
  }
  async canAccessObjectEntity({ userId, objectFile, requestedPermission }: {
    userId?: string; objectFile: File; requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({ userId, objectFile, requestedPermission: requestedPermission ?? ObjectPermission.READ });
  }
}

export function saveLocalUploadedPdf(objectId: string, body: Buffer): void {
  if (!localMode()) throw new Error('Local file storage is disabled');
  if (!/^[0-9a-f-]{36}$/i.test(objectId)) throw new Error('Invalid upload ID');
  if (body.length < 5 || body.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Uploaded file is not a valid PDF');
  const target = path.resolve(localRoot(), 'uploads', objectId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, { flag: 'wx' });
  fs.writeFileSync(`${target}.metadata.json`, JSON.stringify({ contentType: 'application/pdf', metadata: {} }, null, 2));
}

async function signObjectURL({ bucketName, objectName, method, ttlSec }: {
  bucketName: string; objectName: string; method: 'GET' | 'PUT' | 'DELETE' | 'HEAD'; ttlSec: number;
}): Promise<string> {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method, expires_at: new Date(Date.now() + ttlSec * 1000).toISOString() }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Failed to sign object URL (${response.status}); this operation requires Replit storage.`);
  const payload = await response.json() as { signed_url?: unknown };
  if (typeof payload.signed_url !== 'string') throw new Error('Object storage returned an invalid signed URL response');
  return payload.signed_url;
}
