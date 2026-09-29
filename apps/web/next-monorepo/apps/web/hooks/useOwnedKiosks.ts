"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchKiosks } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"

/** Inventory views show current ownership, including for Company accounts. */
export function useOwnedKiosks() {
  const { me, isLoading: loadingMe, isError: errorMe } = useMe()
  const queryClient = useQueryClient()
  const organizationId = me?.membership?.organizationId
  const inventory = useQuery({
    queryKey: ["kiosks"],
    queryFn: fetchKiosks,
    enabled: !!organizationId,
    // Select changes this view without replacing the shared API response cache.
    select: (kiosks) => kiosks.filter((kiosk) => !!organizationId && kiosk.currentOrgId === organizationId),
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
