import crypto from 'node:crypto';

type MemberRole = 'ADMIN' | 'MANAGER' | 'STAFF';
const prefixes: Record<MemberRole, string> = { ADMIN: 'A', MANAGER: 'M', STAFF: 'S' };

// The role is part of the exact random code stored in Organization.inviteCode.
// Changing the prefix invalidates the database lookup; client role input is never trusted.
// Legacy six-character codes retain their pending-approval/distributor semantics.
export function createMemberInvite(role: MemberRole): string {
  return `${prefixes[role]}.${crypto.randomBytes(6).toString('base64url')}`;
}

export function memberInviteRole(code: string): MemberRole | null {
  if (!/^[AMS]\.[A-Za-z0-9_-]{8}$/.test(code)) return null;
  return code[0] === 'A' ? 'ADMIN' : code[0] === 'M' ? 'MANAGER' : 'STAFF';
}
