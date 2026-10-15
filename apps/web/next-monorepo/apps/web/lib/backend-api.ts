import { beginMutationToast } from "./mutation-toast"

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

/**
 * Upper bound on pages walked by the paging helpers. They loop
 * `while (page <= totalPages)`, so a response reporting `totalPages: 0` or omitting
 * `meta` would otherwise leave the exit condition resting on arithmetic alone. The header
 * bell polls those helpers every 10 seconds, so an unbounded walk could hang the tab.
 */
const MAX_PAGES = 100;

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
  'AVAILABLE', 'RESERVED', 'ASSIGNED', 'INSTALLED', 'MAINTENANCE', 'RETURNED', 'RETIRED'
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
  const text = await res.text();
  let json: ApiResponse<T> | { message?: string } | null = null;
  try {
    json = text ? JSON.parse(text) as ApiResponse<T> | { message?: string } : null;
  } catch {
    throw new Error(
      res.ok
        ? 'API returned an invalid response'
        : text || `API request failed (${res.status})`,
    );
  }
  if (!res.ok) throw new Error(json?.message || `API request failed (${res.status})`);
  if (!json || !('data' in json)) throw new Error('API returned an invalid response');
  return json.data as T;
}

// Access tokens are short-lived (15m). When one expires mid-session the API
// returns 401; we transparently hit the refresh endpoint once (single-flighted
// so concurrent calls share one refresh) and replay the original request. If
// refresh fails the user is genuinely logged out and the 401 propagates.
let refreshing: Promise<boolean> | null = null;
let signingOut = false;

function refreshSession(): Promise<boolean> {
  if (signingOut) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(15000) })
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
  const mutationToast = beginMutationToast(opts);
  try {
    const res = await fetch(input, opts);
    // Don't try to refresh the auth calls themselves (would loop / mask bad creds).
    if (res.status !== 401 || /\/api\/auth\/(login|refresh|logout)/.test(input)) return res;
    const ok = await refreshSession();
    return ok ? await fetch(input, opts) : res;
  } finally {
    mutationToast?.finish();
  }
}

export async function fetchInventorySummary(): Promise<InventorySummaryResponse> {
  const res = await apiFetch('/api/kiosks/summary', { credentials: 'include' });
  return handleRes<InventorySummaryResponse>(res);
}

// Orders belong to the supplier/customer relationship, even after kiosk delivery.
export const ORDER_STATUSES = ['UNDER_REVIEW', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'REJECTED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type KioskOrder = {
  id: string;
  orderNumber: string;
  type: 'REQUEST' | 'ALLOCATION';
  status: OrderStatus;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  parentOrgId: string;
  childOrgId: string;
  parentOrg: OrgRef;
  childOrg: OrgRef;
  quantity: number;
  requestedModel: string | null;
  depositPerMachine: number;
  nonRefundablePerMachine: number;
  totalDeposit: number;
  totalNonRefundable: number;
  taxAmount: number;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
};
export type KioskOrderDetails = KioskOrder & {
  dispatchedKiosks: Array<{
    kiosk: { id: string; machineCode: string; model: string | null; status: string };
  }>;
};

export async function fetchOrders(status?: OrderStatus, signal?: AbortSignal): Promise<KioskOrder[]> {
  const query = status ? `?${new URLSearchParams({ status })}` : '';
  const res = await apiFetch(`/api/orders${query}`, { signal, cache: 'no-store' });
  return (await handleRes<{ orders: KioskOrder[] }>(res)).orders;
}

export async function fetchOrderDetails(orderId: string, signal?: AbortSignal): Promise<KioskOrderDetails> {
  const res = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}`, { signal, cache: 'no-store' });
  return (await handleRes<{ order: KioskOrderDetails }>(res)).order;
}

/**
 * Post-approval lifecycle steps. Each is supplier-side (the API requires the caller
 * to be the order's parent organization) and strictly ordered by the API:
 *   APPROVED + unpaid -> paid -> dispatch -> deliver (DELIVERED, terminal).
 * `dispatch` assigns the reserved kiosks; `deliver` transfers their ownership to the
 * child organization and clears their reservation.
 */
export async function markOrderAsPaid(orderId: string): Promise<KioskOrder> {
  const res = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/paid`, { method: 'PATCH' });
  return (await handleRes<{ order: KioskOrder }>(res)).order;
}

export async function dispatchOrder(orderId: string): Promise<KioskOrder> {
  const res = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/dispatch`, { method: 'PATCH' });
  return (await handleRes<{ order: KioskOrder }>(res)).order;
}

export async function deliverOrder(orderId: string): Promise<KioskOrder> {
  const res = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/deliver`, { method: 'PATCH' });
  return (await handleRes<{ order: KioskOrder }>(res)).order;
}

/** Rejects a request under review (supplier-side, like the approve step). */
export async function rejectOrder(orderId: string): Promise<KioskOrder> {
  const res = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/reject`, { method: 'PATCH' });
  return (await handleRes<{ order: KioskOrder }>(res)).order;
}

export type RequestModelAvailability = {
  supplier: OrgRef;
  models: Array<{ model: string; availableQuantity: number }>;
};

export async function fetchRequestModelAvailability(): Promise<RequestModelAvailability> {
  const res = await apiFetch('/api/orders/request-models', {
    credentials: 'include',
    cache: 'no-store',
  });
  return handleRes<RequestModelAvailability>(res);
}

export type CreateOrderInput =
  | { type: 'REQUEST'; quantity: number; model: string }
  | { type: 'ALLOCATION'; targetOrgId: string; quantity: number; model?: string };
export type CreatedOrder = Omit<KioskOrder, 'parentOrg' | 'childOrg'>;

export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 50) {
    throw new Error('Enter a whole number from 1 to 50.');
  }
  if ('model' in input && input.type === 'REQUEST' && !input.model.trim()) {
    throw new Error('Select an available kiosk model.');
  }
  const res = await apiFetch('/api/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await handleRes<{ order: CreatedOrder }>(res)).order;
}

// Read every page: current agreements may follow older relationship history.
export async function fetchOrderRequestSuppliers(organizationId: string, orgType: OrgType, signal?: AbortSignal): Promise<OrgRef[]> {
  const readAll = async (kind: 'network' | 'agreements') => {
    const rows: ReviewRequest[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await fetchReviewRequests(kind, page, signal);
      rows.push(...result.requests);
      // A response may omit `meta`, or report 0 pages; either must not keep the walk alive.
      const reported = result.meta?.totalPages;
      totalPages = Number.isFinite(reported) && reported > 0 ? reported : 1;
      page++;
    } while (page <= totalPages && page <= MAX_PAGES);
    return rows.filter(row => row.status === 'ACTIVE' && row.to.id === organizationId &&
      (row.from.type === 'COMPANY' || (orgType === 'PARTNER' && row.from.type === 'DISTRIBUTOR')));
  };
  const [agreements, networks] = await Promise.all([readAll('agreements'), readAll('network')]);
  const connected = new Set(networks.map(row => row.from.id));
  return [...new Map(agreements.filter(row => connected.has(row.from.id)).map(row => [row.from.id, row.from])).values()];
}

export async function fetchPendingMembers(page = 1, limit = 10): Promise<PendingMembersResponse> {
  const res = await apiFetch(`/api/members/requests?page=${page}&limit=${limit}`, { credentials: 'include' });
  return handleRes<PendingMembersResponse>(res);
}

export async function fetchNetworkRequests(page = 1, limit = 10): Promise<NetworkRequestsResponse> {
  const res = await apiFetch(`/api/network/requests?page=${page}&limit=${limit}`, { credentials: 'include' });
  return handleRes<NetworkRequestsResponse>(res);
}

export type WorkflowReadiness = { orderDecisions: boolean };
export async function fetchWorkflowReadiness(): Promise<WorkflowReadiness> {
  return handleRes<WorkflowReadiness>(await apiFetch('/api/workflows'));
}
export type ReviewRequest = {
  id: string; status: string; from: OrgRef; to: OrgRef; createdAt: string;
  parentSharePct?: string | number; childSharePct?: string | number;
  depositAmountPerMachine?: number; nonRefundableAmountPerMachine?: number;
};
export async function fetchReviewRequests(kind: 'network' | 'agreements', page = 1, signal?: AbortSignal): Promise<{ requests: ReviewRequest[]; meta: PaginationMeta }> {
  const res = await apiFetch(`/api/${kind}?page=${page}&limit=20`, { signal, cache: 'no-store' });
  if (kind === 'network') {
    const data = await handleRes<{ requests: Array<Omit<ReviewRequest, 'from' | 'to'> & { initiator: OrgRef; reciever: OrgRef }>; meta: PaginationMeta }>(res);
    return { meta: data.meta, requests: data.requests.map(row => ({ ...row, from: row.initiator, to: row.reciever })) };
  }
  const data = await handleRes<{ agreements: Array<Omit<ReviewRequest, 'from' | 'to'> & { parentOrg: OrgRef; childOrg: OrgRef }>; meta: PaginationMeta }>(res);
  return { meta: data.meta, requests: data.agreements.map(row => ({ ...row, from: row.parentOrg, to: row.childOrg })) };
}
export async function decideRequest(kind: 'network' | 'agreements' | 'orders', id: string, action: 'approve' | 'reject'): Promise<void> {
  const operation = kind === 'network' && action === 'approve' ? 'accept' : action;
  await handleRes(await apiFetch(`/api/${kind}/${encodeURIComponent(id)}/${operation}`, { method: kind === 'network' ? 'POST' : 'PATCH' }));
}

export type CompanyInviteCode = { inviteCode: string; expiresAt: string; role?: ManageableRole };

export async function generateCompanyMemberInvite(role: ManageableRole): Promise<CompanyInviteCode> {
  return handleRes<CompanyInviteCode>(await apiFetch('/api/members/generateInviteCode', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
  }));
}

export async function generateCompanyInviteCode(): Promise<CompanyInviteCode> {
  const res = await apiFetch('/api/members/generateInviteCode', { method: 'POST' });
  return handleRes<CompanyInviteCode>(res);
}

export type CreateDistributorInput = {
  inviteCode: string;
  orgName: string;
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;
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
  owner: { id: string; name: string; email: string; contact: string };
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

export type CreatePartnerInput = Omit<CreateDistributorInput, 'inviteCode'>;
export type CreatePartnerResult = Omit<CreateDistributorResult, 'credentialsEmailSent'> & {
  credentialsEmailSent: boolean;
};

export async function createPartner(input: CreatePartnerInput): Promise<CreatePartnerResult> {
  return handleRes<CreatePartnerResult>(await apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...input, orgType: 'PARTNER' }),
  }));
}

/**
 * Re-sends a failed credentials invitation. `attemptDelivery` is the only sender and
 * runs inside the request, so the boolean it returns is the real outcome; the resend
 * count lets the caller confirm another attempt actually happened.
 */
export async function retryOrganizationCredentials(organizationId: string): Promise<{ credentialsEmailSent: boolean }> {
  return handleRes(await apiFetch(`/api/auth/organizations/${encodeURIComponent(organizationId)}/credentials/retry`, {
    method: 'POST', credentials: 'include',
  }));
}

export type Distributor = {
  id: string;
  name: string;
  isActive: boolean;
  statusManagementAvailable: boolean;
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

export type Partner = {
  id: string;
  name: string;
  type: 'PARTNER';
  state: string;
  city: string;
  pincode: number;
  address: string;
  owner: { id: string; name: string; email: string } | null;
  connectionId: string | null;
  connectedAt: string | null;
  agreementStatus: 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'TERMINATED' | null;
};

export async function fetchPartners(): Promise<Partner[]> {
  const res = await apiFetch('/api/network/partners', { credentials: 'include', cache: 'no-store' });
  const json = await handleRes<{ partners: Partner[] }>(res);
  return json.partners;
}

export async function logout(): Promise<void> {
  signingOut = true;
  try {
    // Finish any refresh already in flight before revoking its resulting token.
    if (refreshing) await refreshing;
    const res = await fetch('/api/auth/refresh/logout', {
      method: 'POST', credentials: 'include', signal: AbortSignal.timeout(15000),
    });
    await handleRes<null>(res);
  } catch (error) {
    signingOut = false;
    throw error;
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
export type MachineRevenue = {
  machineCode: string;
  location: string;
  distributor: string;
  partner: string;
  deployedPartner: string;
  today: number;
  thisMonth: number;
  totalRevenue: number;
};

export type DeductionRates = {
  gstPercentage: number;
  pgFeePercentage: number;
  tdsPercentage: number;
};

export async function fetchMachineRevenue(): Promise<MachineRevenue[]> {
  const res = await apiFetch('/api/revenue/machine-wise', { credentials: 'include' });
  return (await handleRes<{ kiosks: MachineRevenue[] }>(res)).kiosks;
}

export type MothershipPayment = {
  txnid: string;
  device_id: string;
  game_id: string;
  amount: number;
  currency: string;
  status: string;
  provider: string | null;
  qr_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MothershipPaymentsFeed = {
  total: number;
  payments: MothershipPayment[];
  fetchedAt: string;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** Read the current payment feed without importing or mutating revenue records. */
export async function fetchMothershipPayments(page = 1, signal?: AbortSignal): Promise<MothershipPaymentsFeed> {
  const query = new URLSearchParams({ page: String(page), pageSize: '10' });
  const res = await apiFetch(`/api/revenue/payments?${query.toString()}`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  return handleRes<MothershipPaymentsFeed>(res);
}

export type MothershipSyncResult = {
  devices: {
    totalRecordsFetched: number;
    newKiosksCreated: number;
    kiosksUpdated: number;
    devicesWithoutId: number;
    rejectedRecords: number;
    createdMachineCodes: string[];
  } | null;
  transactions: {
    totalRecordsFetched: number;
    newRecordsInserted: number;
    unattributedCount: number;
  };
};

/** Import completed Mothership payments into the local revenue ledger. */
export async function syncMothershipPayments(): Promise<MothershipSyncResult> {
  const res = await apiFetch('/api/revenue/payments/sync', {
    method: 'POST',
    credentials: 'include',
  });
  return handleRes<MothershipSyncResult>(res);
}

/** Windows offered by the dashboard revenue trend; each also sets its granularity. */
export const REVENUE_SERIES_RANGES = ['7d', '30d', '3m', '1y'] as const;
export type RevenueSeriesRange = (typeof REVENUE_SERIES_RANGES)[number];

export type RevenueSeriesPoint = {
  /** Bucket start (IST), `YYYY-MM-DD`. */
  key: string;
  /** Pre-formatted axis label. */
  label: string;
  revenue: number;
};

export type RevenueSeries = {
  range: RevenueSeriesRange;
  /** "Daily" | "Weekly" | "Monthly", for the panel subtitle. */
  granularity: string;
  bucket: 'day' | 'week' | 'month';
  currency: string;
  /** Sum across the returned points, computed by the API. */
  total: number;
  /** Every bucket in the range, including zero-revenue ones. */
  points: RevenueSeriesPoint[];
};

export async function fetchRevenueSeries(range: RevenueSeriesRange, signal?: AbortSignal): Promise<RevenueSeries> {
  const res = await apiFetch(`/api/revenue/series?range=${encodeURIComponent(range)}`, { credentials: 'include', signal, cache: 'no-store' });
  return handleRes<RevenueSeries>(res);
}

function normalizeRates(settings: Record<keyof DeductionRates, number | string>): DeductionRates {
  return {
    gstPercentage: Number(settings.gstPercentage),
    pgFeePercentage: Number(settings.pgFeePercentage),
    tdsPercentage: Number(settings.tdsPercentage),
  };
}

export async function fetchDeductionRates(): Promise<DeductionRates> {
  const res = await apiFetch('/api/revenue/deduction-rates', { credentials: 'include' });
  return normalizeRates((await handleRes<{ settings: Record<keyof DeductionRates, number | string> }>(res)).settings);
}

export async function updateDeductionRates(input: DeductionRates): Promise<DeductionRates> {
  const res = await apiFetch('/api/revenue/deduction-rates', {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  return normalizeRates((await handleRes<{ settings: Record<keyof DeductionRates, number | string> }>(res)).settings);
}

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

// NOTE: `GET /api/members` is NOT implemented on the backend (the members router
// only exposes /generateInviteCode, /requests, /:id/role and DELETE /:id). This
// would 404. Only the gated, backend-less Roles screen references it — keep that
// gate until an active-member roster endpoint ships.
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
 *
 * NOTE: `POST /api/members` is NOT implemented on the backend and this has no
 * caller today — it would 404. Do not wire it into UI until the create-member
 * route ships; onboarding currently happens via invite code + join request.
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

// ---- Agreements ----
// Decimal/Int columns arrive as strings over JSON, so display fields are widened
// and coerced at render time instead of being assumed numeric.
export type Agreement = {
  id: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'TERMINATED' | 'REJECTED';
  networkConnectionId: string;
  parentOrg: OrgRef;
  childOrg: OrgRef;
  parentSharePct: number | string;
  childSharePct: number | string;
  depositAmountPerMachine: number | string;
  nonRefundableAmountPerMachine: number | string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
};

export type AgreementsResponse = { agreements: Agreement[]; meta: PaginationMeta };

export async function fetchAgreements(page = 1, signal?: AbortSignal): Promise<AgreementsResponse> {
  const res = await apiFetch(`/api/agreements?page=${page}&limit=20`, { signal, cache: 'no-store' });
  return handleRes<AgreementsResponse>(res);
}

/**
 * Every agreement for one child organization, newest first. The endpoint lists the
 * caller's agreements across both roles, so a distributor's latest terms could sit
 * beyond the first page once other relationship history exists.
 */
export async function fetchAgreementsForChild(childOrgId: string, signal?: AbortSignal): Promise<Agreement[]> {
  const rows: Agreement[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await fetchAgreements(page, signal);
    rows.push(...data.agreements.filter(agreement => agreement.childOrg.id === childOrgId));
    const reported = data.meta?.totalPages;
    totalPages = Number.isFinite(reported) && reported > 0 ? reported : 1;
    page++;
  } while (page <= totalPages && page <= MAX_PAGES);
  return rows;
}

/**
 * Terms are required when a Company is the parent. A Distributor drafting for a
 * Partner omits them and inherits its own Company agreement amounts, so they stay
 * optional here; the Company dashboard always sends explicit terms.
 */
export type CreateAgreementInput = {
  childOrgId: string;
  networkConnectionId: string;
  parentSharePct?: number;
  childSharePct?: number;
  depositAmountPerMachine?: number;
  nonRefundableAmountPerMachine?: number;
};

export async function createAgreement(input: CreateAgreementInput): Promise<Agreement> {
  const res = await apiFetch('/api/agreements/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await handleRes<{ agreement: Agreement }>(res)).agreement;
}

export async function terminateAgreement(id: string): Promise<void> {
  await handleRes(await apiFetch(`/api/agreements/${encodeURIComponent(id)}/terminate`, { method: 'DELETE' }));
}

// ---- Network connections ----
export type NetworkConnectionStatus = 'PENDING' | 'ACTIVE' | 'REJECTED';

/** A connection row as returned by `GET /api/network` (all statuses, paginated). */
export type NetworkConnection = {
  id: string;
  status: NetworkConnectionStatus;
  initiatorOrgId: string;
  receiverOrgId: string;
  initiator: OrgRef;
  /** Server-side field name retained as-is to match the response body. */
  reciever: OrgRef;
  createdAt: string;
};

/**
 * Read every page so older relationship history cannot hide the current link,
 * matching how `fetchOrderRequestSuppliers` resolves relationships.
 */
export async function fetchOrganizationConnections(signal?: AbortSignal): Promise<NetworkConnection[]> {
  const rows: NetworkConnection[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await apiFetch(`/api/network?page=${page}&limit=50`, { signal, cache: 'no-store' });
    const data = await handleRes<{ requests: NetworkConnection[]; meta: PaginationMeta }>(res);
    rows.push(...data.requests);
    const reported = data.meta?.totalPages;
    totalPages = Number.isFinite(reported) && reported > 0 ? reported : 1;
    page++;
  } while (page <= totalPages && page <= MAX_PAGES);
  return rows;
}

/**
 * Network request from a parent to a child. Agreements can only be drafted on an
 * ACTIVE connection whose initiator is the parent, so the receiver must accept the
 * request before any terms can be submitted.
 */
export async function initiateConnection(targetOwnerEmail: string): Promise<void> {
  await handleRes(await apiFetch('/api/network/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetOwnerEmail }),
  }));
}
