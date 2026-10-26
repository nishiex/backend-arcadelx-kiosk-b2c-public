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
  /** The Company OWNER is the highest-level Master Admin. */
  isMasterAdmin: boolean
  /** Active Company or Distributor OWNER/ADMIN members may view scoped analytics. */
  canViewAnalytics: boolean
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
  /** Active Distributor members may view their connected Partners. */
  canViewPartners: boolean
  canRegisterPartners: boolean
  canReviewRequests: boolean
  canViewRevenue: boolean
  /** Payment gateway administration is COMPANY + OWNER/ADMIN only. */
  canManageGateways: boolean
  /** Devices are visible for the current org; Company fleet visibility is master-admin only. */
  canViewDevices: boolean
  /** Company master admins may apply prices; other orgs may submit requests. */
  canManageDevicePrices: boolean
  canReviewDevicePriceRequests: boolean
  canRequestDevicePrices: boolean
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
  const isMasterAdmin = isCompany && role === "OWNER"
  const isDistributor = orgType === "DISTRIBUTOR"
  const canTransact = isCompany || isDistributor
  const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN"
  const canViewAnalytics = !isError && me?.membership?.status === "ACTIVE" && (isCompany || isDistributor) && isOwnerOrAdmin

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
    isMasterAdmin,
    canViewAnalytics,
    isDistributor,
    canTransact,
    canManageMembers: isCompany && isOwnerOrAdmin,
    canManageRoles: isCompany && isOwnerOrAdmin,
    canManageNetwork: canTransact && isOwnerOrAdmin,
    canManageAgreements: canTransact && role === "OWNER",
    /** Only a company admin/super-admin (OWNER/ADMIN) may add distributors. */
    canManageDistributors: isCompany && isOwnerOrAdmin,
    canViewPartners: !isError && me?.membership?.status === "ACTIVE" &&
      ((isCompany && isMasterAdmin) || (isDistributor && (isOwnerOrAdmin || role === "MANAGER"))),
    canRegisterPartners: !isError && me?.membership?.status === "ACTIVE" && ((isCompany && isMasterAdmin) || (isDistributor && isOwnerOrAdmin)),
    canReviewRequests: me?.membership?.status === "ACTIVE" && isOwnerOrAdmin,
    canViewRevenue: !isError && me?.membership?.status === "ACTIVE" &&
      (isOwnerOrAdmin || role === "MANAGER") &&
      (isCompany || isDistributor || orgType === "PARTNER"),
    canManageGateways: !isError && me?.membership?.status === "ACTIVE" && isCompany && isOwnerOrAdmin,
    /**
     * The Mothership device fleet is operational data the whole network already sees, so it
     * matches the revenue read scope: COMPANY/DISTRIBUTOR/PARTNER OWNER/ADMIN/MANAGER.
     */
    canViewDevices:
      !isError &&
      me?.membership?.status === "ACTIVE" &&
      (isOwnerOrAdmin || role === "MANAGER") &&
      ((isCompany && isOwnerOrAdmin) || isDistributor || orgType === "PARTNER"),
    /**
     * Changing a game's price writes to live hardware (it alters what a deployed kiosk
     * charges), so it is kept as narrow as the gateway admin surface.
     */
    canManageDevicePrices:
      !isError && me?.membership?.status === "ACTIVE" && isCompany && isOwnerOrAdmin,
    canReviewDevicePriceRequests:
      !isError && me?.membership?.status === "ACTIVE" && (isCompany || isDistributor) && isOwnerOrAdmin,
    canRequestDevicePrices:
      !isError && me?.membership?.status === "ACTIVE" && !isCompany &&
      (isOwnerOrAdmin || role === "MANAGER"),
    permissions,
    can,
  }
}
