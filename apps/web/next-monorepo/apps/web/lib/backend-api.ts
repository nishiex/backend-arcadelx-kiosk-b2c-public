export type ApiResponse<T> = {
  statusCode: number;
  data: T;
  message: string;
  success: boolean;
}

export type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type MemberRequest = {
  id: string;
  userId?: string;
  organizationId?: string;
  role?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  user?: { id: string; name: string; email: string; createdAt?: string };
}

export type PendingMembersResponse = {
  data: MemberRequest[];
  meta: PaginationMeta;
}

export type NetworkRequest = {
  id: string;
  status?: string;
  createdAt?: string;
  initiator?: {
    id: string;
    name: string;
    type?: OrgType;
    city?: string | null;
    state?: string | null;
    owner?: { id: string; name: string; email: string };
  };
};

export type NetworkRequestsResponse = {
  data: NetworkRequest[];
  meta: PaginationMeta;
};

export type InventorySummaryResponse = {
  summary: Record<string, number>;
}

// ---- Auth / identity ----
export type OrgType = 'COMPANY' | 'DISTRIBUTOR' | 'PARTNER';
export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF';

export type Organization = { id: string; name: string; type: OrgType };
export type Membership = {
  organizationId: string;
  status: string;
  role: Role;
  organization: Organization;
  /** Name of the assigned custom permission role, if any. */
  permissionRoleName?: string | null;
};
export type Me = {
  id: string;
  email: string;
  name: string;
  membership: Membership | null;
  /** Effective permission keys as "MODULE:ACTION" (empty when not active). */
  permissions: string[];
};

// ---- Kiosks ----
export const KIOSK_STATUSES = [
  'AVAILABLE'
] as const;
export type KioskStatus = (typeof KIOSK_STATUSES)[number];

// Statuses a user may pick in the status dropdowns. RESERVED and ASSIGNED are
// set by the reserve/assign flows (not manual selection), so they're excluded
// here while remaining valid KioskStatus values for display of existing kiosks.

/** Minimal, non-sensitive org reference returned alongside a kiosk. */
export type OrgRef = { id: string; name: string; type: OrgType };

export type Kiosk = {
  id: string;
  machineCode: string;
  model: string | null;
  status: KioskStatus;
  location: string | null;
  currentOrgId: string | null;
  /** Hardware registration details (nullable — captured at register time). */
  serialNumber?: string | null;
  hardwareFingerprint?: string | null;
  firmwareVersion?: string | null;
  manufactureDate?: string | null;
  warrantyExpiry?: string | null;
  /** Holder org (where the machine currently sits). Null if unassigned. */
  currentOrg: OrgRef | null;
  /** Sub-org from the open assignment ledger row, when a holder placed it further. */
  assignedOrg: OrgRef | null;
};

export type RegisterKioskInput = {
  model: string;
  serialNumber?: string;
  hardwareFingerprint?: string;
  firmwareVersion?: string;
  manufactureDate?: string;
  warrantyExpiry?: string;
  location?: string;
  status?: KioskStatus;
};

const handleRes = async <T,>(res: Response): Promise<T> => {
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || 'API Error');
  return json.data as T;
}

// Access tokens are short-lived (15m). When one expires mid-session the API
// returns 401; we transparently hit the refresh endpoint once (single-flighted
// so concurrent calls share one refresh) and replay the original request. If
// refresh fails the user is genuinely logged out and the 401 propagates.
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const opts: RequestInit = { credentials: 'include', ...init };
  const res = await fetch(input, opts);
  // Don't try to refresh the auth calls themselves (would loop / mask bad creds).
  if (res.status !== 401 || /\/api\/auth\/(login|refresh|logout)/.test(input)) return res;
  const ok = await refreshSession();
  return ok ? fetch(input, opts) : res;
}


export async function fetchInventorySummary(): Promise<InventorySummaryResponse> {
  const res = await apiFetch('/api/kiosks/summary', { credentials: 'include' });
  return handleRes<InventorySummaryResponse>(res);
}

export async function fetchPendingMembers(page = 1, limit = 10): Promise<PendingMembersResponse> {
  const res = await apiFetch(`/api/members/requests?page=${page}&limit=${limit}`, { credentials: 'include' });
  return handleRes<PendingMembersResponse>(res);
}

export async function fetchNetworkRequests(page = 1, limit = 10): Promise<NetworkRequestsResponse> {
  const res = await apiFetch(`/api/network/requests?page=${page}&limit=${limit}`, { credentials: 'include' });
  return handleRes<NetworkRequestsResponse>(res);
}

export type CreateDistributorInput = {
  orgName: string;
  ownerName: string;
  ownerEmail: string;
  state: string;
  city: string;
  pincode: number;
  address: string;
  gstNumber?: string;
  phone?: string;
  country?: string;
};

export type CreateDistributorResult = {
  organization: { id: string; name: string; type: OrgType };
  owner: { id: string; name: string; email: string };
  /**
   * Whether the backend confirmed the credentials email was sent. The current
   * register endpoint does not return this flag (and fails the whole request if
   * the mail send throws), so it is optional — treat "absent" as "unknown".
   */
  credentialsEmailSent?: boolean;
};

/** Creates a DISTRIBUTOR organization (and its owner) via the register endpoint. */
export async function createDistributor(
  input: CreateDistributorInput
): Promise<CreateDistributorResult> {
  const body = Object.fromEntries(
    Object.entries({ ...input, orgType: 'DISTRIBUTOR' }).filter(
      ([, v]) => v !== undefined && v !== ''
    )
  );
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return handleRes<CreateDistributorResult>(res);
}

export type Distributor = {
  id: string;
  name: string;
  type: OrgType;
  city: string;
  state: string;
  pincode: number;
  gstNumber: string | null;
  phone: string | null;
  country: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string } | null;
  _count: { kiosks: number; memberships: number };
};

export async function fetchDistributors(): Promise<Distributor[]> {
  const res = await apiFetch('/api/network/distributors', { credentials: 'include' });
  const json = await handleRes<{ distributors: Distributor[] }>(res);
  return json.distributors;
}

// This backend exposes no logout route yet, and the auth cookies are httpOnly
// (set by setTokenCookies), so client JS cannot clear them. Sign-out is therefore
// client-side only: we clear the query cache and redirect to /login. This call is
// best-effort and never throws — if the backend later adds POST /api/auth/logout
// (to clearCookie + revoke the stored refresh token) it will "just work" and give
// true server-side session invalidation. Until then the server session lingers
// until the tokens expire.
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // Network/endpoint failure must never block sign-out.
  }
}

export async function changePassword(input: {
  email: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  const res = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  await handleRes<unknown>(res);
}

// ---- Support ----
export const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export type SupportTicket = {
  id: string;
  subject: string;
  description: string;
  category: string | null;
  status: SupportStatus;
  priority: SupportPriority;
  createdAt: string;
  updatedAt: string;
  organization: { id: string; name: string; type: OrgType };
  createdBy: { id: string; name: string; email: string };
};

export type CreateSupportTicketInput = {
  subject: string;
  description: string;
  category?: string;
  priority?: SupportPriority;
};

export async function fetchSupportTickets(): Promise<SupportTicket[]> {
  const res = await apiFetch('/api/support', { credentials: 'include' });
  const json = await handleRes<{ tickets: SupportTicket[] }>(res);
  return json.tickets;
}

export async function createSupportTicket(input: CreateSupportTicketInput) {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== '')
  );
  const res = await apiFetch('/api/support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return handleRes<{ ticket: SupportTicket }>(res);
}

export async function updateSupportTicketStatus(id: string, status: SupportStatus) {
  const res = await apiFetch(`/api/support/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });
  return handleRes<{ ticket: SupportTicket }>(res);
}

export async function updateSupportTicketPriority(id: string, priority: SupportPriority) {
  const res = await apiFetch(`/api/support/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ priority }),
  });
  return handleRes<{ ticket: SupportTicket }>(res);
}

export async function fetchMe(): Promise<Me> {
  const res = await apiFetch('/api/auth/me', { credentials: 'include' });
  const json = await handleRes<{ user: Me }>(res);
  return json.user;
}

export async function fetchKiosks(): Promise<Kiosk[]> {
  const res = await apiFetch('/api/kiosks', { credentials: 'include' });
  const json = await handleRes<{ kiosks: Kiosk[] }>(res);
  return json.kiosks;
}

export async function createKioskBatch(input: { count: number; model: string }) {
  const res = await apiFetch('/api/kiosks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handleRes<{ count: number; startCode: string; endCode: string }>(res);
}

export async function registerKiosk(input: RegisterKioskInput) {
  // Drop empty-string optionals so the backend treats them as absent.
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== '')
  );
  const res = await apiFetch('/api/kiosks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return handleRes<{ kiosk: Kiosk }>(res);
}

export async function updateKioskStatus(
  id: string,
  input: { status: KioskStatus; location?: string }
) {
  const res = await apiFetch(`/api/kiosks/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handleRes<{ kiosk: Kiosk }>(res);
}

// ---- Reports / revenue ----
export type OrgMini = { id: string; name: string };

export type RevenueReportRow = {
  kioskId: string;
  machineCode: string;
  model: string | null;
  partner: OrgMini | null;
  grossRevenue: number;
  companyShare: number;
  distributorShare: number;
  companySharePct: number;
};

export type RevenueReport = {
  year: number;
  month: number;
  rows: RevenueReportRow[];
  totals: { grossRevenue: number; companyShare: number; distributorShare: number };
};

export async function fetchRevenueReport(
  year: number,
  month: number,
  organizationId?: string
): Promise<RevenueReport> {
  const qs = new URLSearchParams({ year: String(year), month: String(month) });
  if (organizationId) qs.set('organizationId', organizationId);
  const res = await apiFetch(`/api/reports/revenue?${qs.toString()}`, { credentials: 'include' });
  return handleRes<RevenueReport>(res);
}

// ---- Settlements ----
export type SettlementStatus = 'PENDING' | 'PAID';
export type Settlement = {
  id: string;
  reference: string;
  year: number;
  month: number;
  grossRevenue: number;
  companyShare: number;
  distributorShare: number;
  status: SettlementStatus;
  createdAt: string;
  organization: OrgMini;
  paidToDate: number;
};

export async function fetchSettlements(): Promise<Settlement[]> {
  const res = await apiFetch('/api/settlements', { credentials: 'include' });
  const json = await handleRes<{ settlements: Settlement[] }>(res);
  return json.settlements;
}

export async function generateSettlements(year: number, month: number, organizationId?: string) {
  const res = await apiFetch('/api/settlements/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ year, month, ...(organizationId ? { organizationId } : {}) }),
  });
  return handleRes<{ count: number }>(res);
}

// ---- Payments ----
export type PaymentRow = {
  id: string;
  reference: string;
  amount: number;
  method: string;
  transactionRef: string | null;
  paidAt: string;
  organization: OrgMini;
  settlement: { id: string; reference: string } | null;
};

export type PaymentsResponse = { payments: PaymentRow[]; totalReceived: number };

export async function fetchPayments(): Promise<PaymentsResponse> {
  const res = await apiFetch('/api/payments', { credentials: 'include' });
  return handleRes<PaymentsResponse>(res);
}

// ---- Audit Logs (company only) ----
export type AuditLog = {
  id: string;
  actorName: string;
  actorOrgType: string | null;
  actorOrgName: string | null;
  action: string;
  entity: string;
  reference: string | null;
  detail: string | null;
  method: string;
  path: string;
  statusCode: number;
  status: string;
  createdAt: string;
};

export type AuditLogsResponse = {
  logs: AuditLog[];
  meta: PaginationMeta;
};

export async function fetchAuditLogs(
  page = 1,
  limit = 20,
  filters: { actorOrgType?: OrgType; entity?: string; action?: string } = {}
): Promise<AuditLogsResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.actorOrgType) params.set('actorOrgType', filters.actorOrgType);
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.action) params.set('action', filters.action);
  const res = await apiFetch(`/api/audit-logs?${params.toString()}`, { credentials: 'include' });
  return handleRes<AuditLogsResponse>(res);
}

// ---- Roles & Permissions (RBAC) ----
export const PERMISSION_MODULES = [
  'STAFF',
  'ROLES',
  'DISTRIBUTORS',
  'PARTNERS',
  'KIOSKS',
  'ORDERS',
  'REVENUE',
  'REPORTS',
  'SETTLEMENTS',
  'PAYMENTS',
  'AGREEMENTS',
  'NETWORK',
  'SUPPORT',
  'AUDIT_LOGS',
  'SETTINGS',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_ACTIONS = [
  'CREATE',
  'EDIT',
  'DELETE',
  'VIEW',
  'VIEW_ALL',
  'EXPORT',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type PermissionEntry = { module: PermissionModule; action: PermissionAction };

/** Row in the roles list (with member/permission counts). */
export type RoleSummary = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  _count: { memberships: number; permissions: number };
};

/** A single role plus its full granted matrix. */
export type RoleDetail = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionEntry[];
};

export async function fetchRoles(): Promise<RoleSummary[]> {
  const res = await apiFetch('/api/roles', { credentials: 'include' });
  const json = await handleRes<{ roles: RoleSummary[] }>(res);
  return json.roles;
}

export async function fetchRole(id: string): Promise<RoleDetail> {
  const res = await apiFetch(`/api/roles/${id}`, { credentials: 'include' });
  const json = await handleRes<{ role: RoleDetail }>(res);
  return json.role;
}

export async function createRole(input: {
  name: string;
  description?: string;
  entries?: PermissionEntry[];
}): Promise<{ id: string; name: string; description: string | null; isSystem: boolean }> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== '')
  );
  const res = await apiFetch('/api/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const json = await handleRes<{ role: { id: string; name: string; description: string | null; isSystem: boolean } }>(res);
  return json.role;
}

export async function updateRole(
  id: string,
  input: { name?: string; description?: string }
): Promise<void> {
  const res = await apiFetch(`/api/roles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  await handleRes<unknown>(res);
}

/** Replace a role's entire granted matrix with `entries`. */
export async function saveRoleMatrix(id: string, entries: PermissionEntry[]): Promise<number> {
  const res = await apiFetch(`/api/roles/${id}/matrix`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ entries }),
  });
  const json = await handleRes<{ count: number }>(res);
  return json.count;
}

export async function deleteRole(id: string): Promise<void> {
  const res = await apiFetch(`/api/roles/${id}`, { method: 'DELETE', credentials: 'include' });
  await handleRes<unknown>(res);
}

export async function assignRole(
  membershipId: string,
  permissionRoleId: string | null
): Promise<void> {
  const res = await apiFetch('/api/roles/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ membershipId, permissionRoleId }),
  });
  await handleRes<unknown>(res);
}

// ---- Members (active roster, for role assignment) ----
export type OrgMember = {
  id: string;
  role: Role | null;
  permissionRoleId: string | null;
  user: { id: string; name: string; email: string };
  permissionRole: { id: string; name: string } | null;
};

export async function fetchMembers(): Promise<OrgMember[]> {
  const res = await apiFetch('/api/members', { credentials: 'include' });
  const json = await handleRes<{ members: OrgMember[] }>(res);
  return json.members;
}

// ---- User management (COMPANY + OWNER/ADMIN) ----
/** Base roles an admin can assign (OWNER is excluded — one owner, not reassignable). */
export const MANAGEABLE_ROLES = ['ADMIN', 'MANAGER', 'STAFF'] as const;
export type ManageableRole = (typeof MANAGEABLE_ROLES)[number];

export type CreateMemberInput = {
  name: string;
  email: string;
  role: ManageableRole;
  /** Optional — blank asks the server to auto-generate and email a password. */
  password?: string;
  aadharNumber?: string;
  panNumber?: string;
  mobile?: string;
  alternateMobile?: string;
  dateOfBirth?: string;
  emergencyContact?: string;
  address?: string;
};

export type CreateMemberResult = {
  member: OrgMember;
  credentialsEmailSent: boolean;
  passwordGenerated: boolean;
};

/**
 * Directly create an active member (mints the account + emails temporary
 * credentials). Company OWNER/ADMIN only; role must be below the caller's own.
 */
export async function createMember(input: CreateMemberInput): Promise<CreateMemberResult> {
  // Drop empty-string optionals so the backend treats them as absent.
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== '')
  );
  const res = await apiFetch('/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return handleRes<CreateMemberResult>(res);
}

/** Approve a pending join request (with a base role) or reject it. */
export async function handleJoinRequest(
  membershipId: string,
  action: 'APPROVE' | 'REJECT',
  role?: ManageableRole
): Promise<void> {
  const res = await apiFetch(`/api/members/requests/${membershipId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action, ...(role ? { role } : {}) }),
  });
  await handleRes<unknown>(res);
}

/** Change an active member's base (enum) role. */
export async function updateMemberRole(membershipId: string, role: ManageableRole): Promise<void> {
  const res = await apiFetch(`/api/members/${membershipId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role }),
  });
  await handleRes<unknown>(res);
}

/** Remove an active member from the organization. */
export async function removeMember(membershipId: string): Promise<void> {
  const res = await apiFetch(`/api/members/${membershipId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await handleRes<unknown>(res);
}
