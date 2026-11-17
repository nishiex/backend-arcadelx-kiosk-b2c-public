/**
 * IP parties (`/api/ip`).
 *
 * Onboarding is Company-driven: only the master admin (Company OWNER) creates an IP
 * party, and the API emails the new owner a temporary password. Reads are likewise
 * Company-scoped, so every call here assumes an active Company session.
 */
import { apiFetch, handleRes } from "./backend-api"

export type IpAgreementStatus = "DRAFT" | "ACTIVE" | "TERMINATED"

export type IpAgreementSummary = {
  id: string
  ipSharePct: number
  companySharePct: number
  effectiveFrom: string
  status: IpAgreementStatus
}

export type IpParty = {
  id: string
  name: string
  city: string
  state: string
  createdAt: string
  owner: {
    id: string
    name: string
    email: string
    contact: string | null
  } | null
  ipProfile: {
    id: string
    sourceKey: string
    legalName: string
    pan: string
    gstin: string | null
    statementEmail: string | null
  } | null
  /** At most one ACTIVE agreement is returned by the API. */
  ipAgreements: IpAgreementSummary[]
  /** False until the temporary-password email has actually been delivered. */
  credentialsEmailSent: boolean
}

export type RegisterIpPartyInput = {
  orgName: string
  ownerName: string
  ownerEmail: string
  ownerContact: string
  address: string
  city: string
  state: string
  pincode: number
  legalName?: string
  pan: string
  gstin?: string
  statementEmail?: string
  sourceKey: string
  ipSharePct: number
  effectiveFrom?: string
}

export type RegisteredIpParty = {
  organization: { id: string; name: string; type: string }
  owner: {
    id: string
    name: string
    email: string
    contact: string | null
    mustChangePassword: boolean
  }
  ipProfile: {
    id: string
    sourceKey: string
    legalName: string
    pan: string
    gstin: string | null
    statementEmail: string | null
  }
  agreement: {
    id: string
    ipSharePct: number
    companySharePct: number
    effectiveFrom: string
    status: IpAgreementStatus
  }
  credentialsEmailSent: boolean
}

export type IpGame = {
  id: string
  organizationId: string
  gameIdentifier: string
  displayName: string
  coverImageUrl: string | null
  launchDate: string | null
  status: string
  createdAt: string
}

export type IpDailyRevenue = {
  businessDate: string
  timezone: string
  summary: Record<string, string | number>
  games: Array<{
    gameId: string
    gameIdentifier: string
    displayName: string
    kioskCount: number
    grossRevenue: string
    ipRoyaltyShare: string
  }>
  aggregationStatus: string
  globalJobStatus: string | null
}

export type IpSettlement = {
  id: string
  month: number
  year: number
  grossRevenue: string
  ipRoyaltyShare: string
  finalPayout: string
  totalKioskCount: number
  status: string
  hasPdf: boolean
  emailDeliveredAt: string | null
  linesCount?: number
  createdAt: string
  lines?: Array<{ gameIdentifier: string; gameDisplayName: string; kioskCount: number; grossRevenue: string; ipRoyaltyShare: string }>
}

export async function fetchIpParties(): Promise<IpParty[]> {
  const res = await apiFetch("/api/ip/parties", { credentials: "include", cache: "no-store" })
  const data = await handleRes<{ parties: IpParty[] }>(res)
  return data.parties
}

export async function registerIpParty(input: RegisterIpPartyInput): Promise<RegisteredIpParty> {
  const res = await apiFetch("/api/ip/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return handleRes<RegisteredIpParty>(res)
}

export async function fetchMyIpGames(): Promise<IpGame[]> {
  const res = await apiFetch("/api/ip/games/my-games", { credentials: "include", cache: "no-store" })
  const data = await handleRes<{ games: IpGame[] }>(res)
  return data.games
}

export async function fetchMyIpDailyRevenue(date?: string): Promise<IpDailyRevenue> {
  const query = date ? `?date=${encodeURIComponent(date)}` : ""
  const res = await apiFetch(`/api/ip/revenue/daily${query}`, { credentials: "include", cache: "no-store" })
  return handleRes<IpDailyRevenue>(res)
}

export async function fetchMyIpSettlements(year?: number): Promise<IpSettlement[]> {
  const query = year ? `?year=${year}&limit=50` : "?limit=50"
  const res = await apiFetch(`/api/ip/settlements${query}`, { credentials: "include", cache: "no-store" })
  const data = await handleRes<{ settlements: IpSettlement[] }>(res)
  return data.settlements
}

export async function downloadMyIpSettlement(id: string): Promise<Blob> {
  const res = await apiFetch(`/api/ip/settlements/${encodeURIComponent(id)}/download`, { credentials: "include" })
  if (!res.ok) await handleRes<never>(res)
  return res.blob()
}

export async function fetchIpPartyGames(ipOrgId: string): Promise<IpGame[]> {
  const res = await apiFetch(`/api/ip/games/${encodeURIComponent(ipOrgId)}`, { credentials: "include", cache: "no-store" })
  const data = await handleRes<{ games: IpGame[] }>(res)
  return data.games
}

export async function fetchAvailableIpGameIds(ipOrgId: string) {
  const res = await apiFetch(`/api/ip/games/${encodeURIComponent(ipOrgId)}/available-identifiers`, { credentials: "include", cache: "no-store" })
  return handleRes<{ organization: { id: string; name: string; sourceKey: string }; availableGameIds: Array<{ gameId: string; normalizedGameIdentifier: string; suggestedDisplayName: string; transactionCount: number; lastObservedAt: string }>; total: number }>(res)
}

export async function createIpGame(ipOrgId: string, input: { displayName: string; gameIdentifier: string; coverImageUrl?: string; launchDate?: string }) {
  const res = await apiFetch(`/api/ip/games/${encodeURIComponent(ipOrgId)}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
  return handleRes<{ game: IpGame }>(res)
}

export async function fetchCompanyIpDailyRevenue(ipOrgId: string, date?: string): Promise<IpDailyRevenue> {
  const query = date ? `?date=${encodeURIComponent(date)}` : ""
  const res = await apiFetch(`/api/ip/revenue/${encodeURIComponent(ipOrgId)}/daily${query}`, { credentials: "include", cache: "no-store" })
  return handleRes<IpDailyRevenue>(res)
}

export async function updateIpPercentage(ipOrgId: string, input: { ipSharePct: number; effectiveFrom?: string }) {
  const res = await apiFetch(`/api/ip/${encodeURIComponent(ipOrgId)}/percentage`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
  return handleRes(res)
}

export async function fetchCompanyIpSettlements(ipOrgId: string): Promise<IpSettlement[]> {
  const res = await apiFetch(`/api/ip/settlements/company/${encodeURIComponent(ipOrgId)}`, { credentials: "include", cache: "no-store" })
  const data = await handleRes<{ settlements: IpSettlement[] }>(res)
  return data.settlements
}

export async function triggerIpDailyAggregation(input: { date?: string; lookbackDays?: number }) {
  const res = await apiFetch("/api/ip/revenue/daily/aggregate", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
  return handleRes(res)
}

export async function triggerIpMonthlySettlements(input: { month: number; year: number; force?: boolean }) {
  const res = await apiFetch("/api/ip/settlements/trigger", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
  return handleRes(res)
}
