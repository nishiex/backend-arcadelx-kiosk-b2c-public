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
