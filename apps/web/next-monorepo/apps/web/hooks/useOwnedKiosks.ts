"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchKiosks } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"

/**
 * Inventory views show current ownership, including for Company accounts.
 *
 * `includeNetworkInventory` opts a view into the full network scope the API already returns:
 * a Distributor's own stock plus the machines it placed with children, and for a Company master
 * admin the whole fleet down to Partners. Machines and the Ad library ask for it, so summary
 * widgets keep their existing "my organization's stock" reading.
 */
export function useOwnedKiosks({
  includeNetworkInventory = false,
}: { includeNetworkInventory?: boolean } = {}) {
  const { me, isLoading: loadingMe, isError: errorMe } = useMe()
  const queryClient = useQueryClient()
  const organizationId = me?.membership?.organizationId
  const inventory = useQuery({
    queryKey: ["kiosks"],
    queryFn: fetchKiosks,
    enabled: !!organizationId,
    // Pairing and unpairing are initiated by the hardware, so the list has to notice them on
    // its own; polling only runs while the tab is visible.
    refetchInterval: 30_000,
    // Select changes this view without replacing the shared API response cache.
    // The API already scopes a Distributor to its own stock plus the machines it placed with
    // children, so those rows have to survive here. Company and Partner keep the old cut:
    // only the machines their own organization currently holds.
    select: (kiosks) =>
      kiosks.filter(
        (kiosk) =>
          !!organizationId &&
          (includeNetworkInventory || kiosk.currentOrgId === organizationId),
      ),
  })

  return {
    ...inventory,
    isLoading: loadingMe || inventory.isLoading,
    isError: errorMe || inventory.isError,
    refetch: async () => {
      if (errorMe) await queryClient.refetchQueries({ queryKey: ["me"], exact: true })
      return inventory.refetch()
    },
  }
}
