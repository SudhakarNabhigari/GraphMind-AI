import fs from 'fs';
import { File } from '@google-cloud/storage';

const ACL_POLICY_METADATA_KEY = 'custom:aclPolicy';
export enum ObjectAccessGroupType {}
export interface ObjectAccessGroup { type: ObjectAccessGroupType; id: string; }
export enum ObjectPermission { READ = 'read', WRITE = 'write' }
export interface ObjectAclRule { group: ObjectAccessGroup; permission: ObjectPermission; }
export interface ObjectAclPolicy { owner: string; visibility: 'public' | 'private'; aclRules?: Array<ObjectAclRule>; }

function isLocal(file: File): boolean {
  return process.env.LOCAL_FILE_STORAGE === 'true' && typeof (file as any).setMetadata === 'function' &&
    typeof (file as any).name === 'string' && !('bucket' in (file as any));
}
function policyPath(file: File): string | null {
  if (!isLocal(file)) return null;
  const f = file as any;
  const root = require('path').resolve(process.env.LOCAL_STORAGE_DIR || require('path').join(process.cwd(), '.local-object-storage'));
  const actual = require('path').resolve(root, `${f.name}.metadata.json`);
  if (!actual.startsWith(root + require('path').sep)) throw new Error('Invalid local object path');
  return actual;
}
export async function setObjectAclPolicy(objectFile: File, aclPolicy: ObjectAclPolicy): Promise<void> {
  const localPath = policyPath(objectFile);
  if (localPath) {
    if (!fs.existsSync((objectFile as any).fullPath || require('path').resolve(process.env.LOCAL_STORAGE_DIR || require('path').join(process.cwd(), '.local-object-storage'), (objectFile as any).name))) {
      const [exists] = await objectFile.exists();
      if (!exists) throw new Error(`Object not found: ${(objectFile as any).name}`);
    }
    let current: any = {};
    try { current = JSON.parse(fs.readFileSync(localPath, 'utf8')); } catch {}
    current.metadata = { ...(current.metadata || {}), [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy) };
    fs.mkdirSync(require('path').dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, JSON.stringify(current, null, 2));
    return;
  }
  const [exists] = await objectFile.exists();
  if (!exists) throw new Error(`Object not found: ${objectFile.name}`);
  await objectFile.setMetadata({ metadata: { [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy) } });
}
export async function getObjectAclPolicy(objectFile: File): Promise<ObjectAclPolicy | null> {
  const localPath = policyPath(objectFile);
  let aclPolicy: any;
  if (localPath) {
    try { aclPolicy = JSON.parse(fs.readFileSync(localPath, 'utf8')).metadata?.[ACL_POLICY_METADATA_KEY]; } catch { return null; }
  } else {
    const [metadata] = await objectFile.getMetadata();
    aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  }
  if (!aclPolicy) return null;
  return typeof aclPolicy === 'string' ? JSON.parse(aclPolicy) : aclPolicy;
}
function isPermissionAllowed(requested: ObjectPermission, granted: ObjectPermission): boolean {
  return requested === ObjectPermission.READ ? [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted) : granted === ObjectPermission.WRITE;
}
abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(public readonly type: ObjectAccessGroupType, public readonly id: string) {}
  public abstract hasMember(userId: string): Promise<boolean>;
}
function createObjectAccessGroup(group: ObjectAccessGroup): BaseObjectAccessGroup {
  switch (group.type) {
    default: throw new Error(`Unknown access group type: ${group.type}`);
  }
}
export async function canAccessObject({ userId, objectFile, requestedPermission }: {
  userId?: string; objectFile: File; requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) return false;
  if (aclPolicy.visibility === 'public' && requestedPermission === ObjectPermission.READ) return true;
  if (!userId) return false;
  if (aclPolicy.owner === userId) return true;
  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if ((await accessGroup.hasMember(userId)) && isPermissionAllowed(requestedPermission, rule.permission)) return true;
  }
  return false;
}
