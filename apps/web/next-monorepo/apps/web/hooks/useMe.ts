"use client"

import { useQuery } from "@tanstack/react-query"
import {
  fetchMe,
  type Me,
  type OrgType,
  type Role,
  type PermissionModule,
  type PermissionAction,
} from "@/lib/backend-api"

export type Permissions = {
  me: Me | undefined
  isLoading: boolean
  isError: boolean
  orgType: OrgType | null
  role: Role | null
  orgName: string | null
  /** COMPANY can mint kiosks and manage members. */
  isCompany: boolean
  isDistributor: boolean
  /** COMPANY or DISTRIBUTOR — the two org types that transact. */
  canTransact: boolean
  /** Members management is COMPANY + OWNER/ADMIN. */
  canManageMembers: boolean
  /** Roles & permissions management is COMPANY + OWNER/ADMIN only. */
  canManageRoles: boolean
  /** Network + agreements need OWNER/ADMIN (agreements are OWNER-only). */
  canManageNetwork: boolean
  canManageAgreements: boolean
  canManageDistributors: boolean
  canRegisterPartners: boolean
  canReviewRequests: boolean
  canViewRevenue: boolean
  /** Payment gateway administration is COMPANY + OWNER/ADMIN only. */
  canManageGateways: boolean
  /** Effective permission keys ("MODULE:ACTION"). */
  permissions: string[]
  /** Fine-grained matrix check. OWNER always passes (never locked out). */
  can: (module: PermissionModule, action: PermissionAction) => boolean
}

export function useMe(): Permissions {
  const { data: me, isLoading, isError } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 1000 * 60 * 5,
    // Recheck organization access while a Distributor has the dashboard open.
    refetchInterval: query => query.state.data?.membership?.organization.type === "DISTRIBUTOR" ? 30000 : false,
    refetchOnWindowFocus: "always",
    retry: 1,
  })

  const orgType = me?.membership?.organization.type ?? null
  const role = me?.membership?.role ?? null
  const orgName = me?.membership?.organization.name ?? null

  const isCompany = orgType === "COMPANY"
  const isDistributor = orgType === "DISTRIBUTOR"
  const canTransact = isCompany || isDistributor
  const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN"

  const permissions = me?.permissions ?? []
  const permSet = new Set(permissions)
  const can = (module: PermissionModule, action: PermissionAction): boolean =>
    role === "OWNER" || permSet.has(`${module}:${action}`)

  return {
    me,
    isLoading,
    isError,
    orgType,
    role,
    orgName,
    isCompany,
    isDistributor,
    canTransact,
    canManageMembers: isCompany && isOwnerOrAdmin,
    canManageRoles: isCompany && isOwnerOrAdmin,
    canManageNetwork: canTransact && isOwnerOrAdmin,
    canManageAgreements: canTransact && role === "OWNER",
    /** Only a company admin/super-admin (OWNER/ADMIN) may add distributors. */
    canManageDistributors: isCompany && isOwnerOrAdmin,
    canRegisterPartners: !isError && me?.membership?.status === "ACTIVE" && isDistributor && isOwnerOrAdmin,
    canReviewRequests: me?.membership?.status === "ACTIVE" && isOwnerOrAdmin,
    canViewRevenue: !isError && me?.membership?.status === "ACTIVE" &&
      (isOwnerOrAdmin || role === "MANAGER") &&
      (isCompany || isDistributor || orgType === "PARTNER"),
    canManageGateways: !isError && me?.membership?.status === "ACTIVE" && isCompany && isOwnerOrAdmin,
    permissions,
    can,
  }
}
