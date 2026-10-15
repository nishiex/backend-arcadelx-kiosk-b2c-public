"use client"

import React, { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useMe } from "@/hooks/useMe"
import {
  fetchDeductionRates,
  fetchMachineRevenue,
  fetchMothershipPayments,
  updateDeductionRates,
  type DeductionRates,
} from "@/lib/backend-api"
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
} from "@/components/dashboard/ui"

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
})
const buttonClass =
  "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
const rateFields = [
  ["gstPercentage", "GST (%)"],
  ["pgFeePercentage", "Payment gateway fee (%)"],
  ["tdsPercentage", "TDS (%)"],
] as const

function RateEditor({
  rates,
  queryKey,
  onClose,
}: {
  rates: DeductionRates
  queryKey: readonly string[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        rateFields.map(([key]) => [key, String(rates[key])])
      ) as Record<keyof DeductionRates, string>
  )
  const [validation, setValidation] = useState("")
  const mutation = useMutation({
    mutationFn: updateDeductionRates,
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved)
      void qc.invalidateQueries({ queryKey: ["revenue-rates"] })
      toast.success("Deduction rates updated")
      onClose()
    },
  })
  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mutation.isPending) return
    const next = Object.fromEntries(
      rateFields.map(([key]) => [key, Number(values[key])])
    ) as DeductionRates
    if (
      rateFields.some(
        ([key]) =>
          !values[key].trim() ||
          !Number.isFinite(next[key]) ||
          next[key] < 0 ||
          next[key] > 100 ||
          Math.abs(next[key] * 100 - Math.round(next[key] * 100)) > 1e-8
      )
    ) {
      setValidation("Enter rates from 0 to 100 with up to two decimal places.")
      return
    }
    if (
      Math.round(next.gstPercentage * 100) +
        Math.round(next.pgFeePercentage * 100) >
      10000
    ) {
      setValidation("GST plus payment gateway fees cannot exceed 100%.")
      return
    }
    setValidation("")
    mutation.mutate(next)
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {rateFields.map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key} className="mb-1.5 block text-sm font-medium">
              {label}
            </label>
            <input
              id={key}
              className={inputClass}
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              disabled={mutation.isPending}
              value={values[key]}
              onChange={(event) =>
                setValues({ ...values, [key]: event.target.value })
              }
            />
          </div>
        ))}
      </div>
      {(validation || mutation.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {validation || mutation.error?.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={mutation.isPending}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={buttonClass}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Save rates"}
        </button>
      </div>
    </form>
  )
}

export default function RevenueScreen() {
  const { me, isLoading, isError, canViewRevenue, isCompany, role } = useMe()
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState(false)
  const [paymentsRequested, setPaymentsRequested] = useState(false)
  const [paymentsPage, setPaymentsPage] = useState(1)
  const scope = [me?.id ?? "", me?.membership?.organizationId ?? "", role ?? ""]
  const ratesKey = ["revenue-rates", ...scope]
  const revenue = useQuery({
    queryKey: ["revenue-machines", ...scope],
    queryFn: fetchMachineRevenue,
    enabled: canViewRevenue,
    staleTime: 60_000,
    retry: 1,
  })
  const rates = useQuery({
    queryKey: ratesKey,
    queryFn: fetchDeductionRates,
    enabled: canViewRevenue,
    staleTime: 60_000,
    retry: 1,
  })
  const canEdit =
    canViewRevenue && isCompany && (role === "OWNER" || role === "ADMIN")
  const payments = useQuery({
    queryKey: ["mothership-payments", paymentsPage, ...scope],
    queryFn: ({ signal }) => fetchMothershipPayments(paymentsPage, signal),
    enabled: canEdit && paymentsRequested,
    staleTime: 30_000,
    retry: 1,
  })
  if (isLoading)
    return (
      <div aria-label="Loading revenue" className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  if (isError)
    return (
      <ErrorState message="Unable to verify your access. Refresh the page to try again." />
    )
  if (!canViewRevenue)
    return (
      <EmptyState message="Revenue is available to active Owners, Admins and Managers." />
    )
  const rows = revenue.data ?? []
  const filtered = rows.filter((row) =>
    [row.machineCode, row.location, row.distributor, row.partner].some(
      (value) => value.toLowerCase().includes(search.trim().toLowerCase())
    )
  )
  const refreshing =
    revenue.isFetching || rates.isFetching || payments.isFetching
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Revenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gross revenue across your fleet. All amounts in INR; day and month
            follow India Standard Time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button
              className={buttonClass}
              disabled={refreshing || editing}
              onClick={() => {
                if (paymentsRequested && paymentsPage === 1) {
                  void payments.refetch()
                  return
                }
                setPaymentsPage(1)
                setPaymentsRequested(true)
              }}
            >
              <span className="flex items-center gap-2">
                <Download size={16} className={payments.isFetching ? "animate-pulse" : ""} />
                {payments.isFetching ? "Fetching payments…" : "Fetch latest payments"}
              </span>
            </button>
          )}
          <button
            className={buttonClass}
            disabled={refreshing || editing}
            onClick={() => {
              void revenue.refetch()
              void rates.refetch()
              if (canEdit && paymentsRequested) void payments.refetch()
            }}
          >
            <span className="flex items-center gap-2">
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </span>
          </button>
        </div>
      </header>
      {revenue.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : revenue.isError ? (
        <ErrorState
          message={revenue.error.message}
          onRetry={() => void revenue.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["today", "Today"],
                ["thisMonth", "This month"],
                ["totalRevenue", "All time"],
              ] as const
            ).map(([key, title]) => (
              <Panel key={key} title={title}>
                <p className="text-2xl font-semibold tabular-nums">
                  {money.format(
                    rows.reduce(
                      (sum, row) => sum + Math.round(row[key] * 100),
                      0
                    ) / 100
                  )}
                </p>
              </Panel>
            ))}
          </div>
          <Panel title="Machine revenue" subtitle={`${rows.length} machines`}>
            <label
              htmlFor="revenue-search"
              className="mb-1.5 block text-sm font-medium"
            >
              Search machines
            </label>
            <input
              id="revenue-search"
              className={`${inputClass} mb-4 max-w-md`}
              placeholder="Machine, location, distributor or partner"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {!rows.length ? (
              <EmptyState message="No machine revenue to show yet." />
            ) : !filtered.length ? (
              <EmptyState message="No machines match your search." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <caption className="sr-only">
                    Gross revenue by machine in INR
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      {[
                        "Machine",
                        "Location",
                        "Distributor",
                        "Partner",
                        "Today",
                        "This month",
                        "All time",
                      ].map((label, index) => (
                        <th
                          scope="col"
                          key={label}
                          className={`px-3 py-3 font-medium ${index > 3 ? "text-right" : ""}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr
                        key={row.machineCode}
                        className="border-b border-border/60 last:border-0"
                      >
                        <th
                          scope="row"
                          className="px-3 py-3 text-left font-medium"
                        >
                          {row.machineCode}
                        </th>
                        {[row.location, row.distributor, row.partner].map(
                          (value, index) => (
                            <td key={index} className="px-3 py-3">
                              {value}
                            </td>
                          )
                        )}
                        {[row.today, row.thisMonth, row.totalRevenue].map(
                          (value, index) => (
                            <td
                              key={index}
                              className="px-3 py-3 text-right tabular-nums"
                            >
                              {money.format(value)}
                            </td>
                          )
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      {canEdit && (
        <Panel
          title="Mothership payments"
          subtitle="Live payment feed. Load it when needed. Results show the newest 50 records per page and are not imported into revenue totals."
        >
          {!paymentsRequested ? (
            <EmptyState message="Select Fetch latest payments when you need to inspect the live feed." />
          ) : payments.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : payments.isError ? (
            <ErrorState
              message={payments.error.message}
              onRetry={() => void payments.refetch()}
            />
          ) : !payments.data.payments.length ? (
            <EmptyState message="No payments were returned by Mothership." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <caption className="sr-only">
                  Mothership payment records. Payment statuses are not revenue totals.
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    {["Date", "Transaction", "Device", "Game", "Amount", "Status", "Provider"].map(
                      (label) => (
                        <th scope="col" key={label} className="px-3 py-3 font-medium">
                          {label}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {payments.data.payments.map((payment) => (
                    <tr
                      key={payment.txnid}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-3">
                        {new Date(payment.created_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <th scope="row" className="px-3 py-3 text-left font-medium">
                        {payment.txnid}
                      </th>
                      <td className="px-3 py-3">{payment.device_id}</td>
                      <td className="px-3 py-3">{payment.game_id}</td>
                      <td className="px-3 py-3 tabular-nums">
                        {new Intl.NumberFormat("en-IN", {
                          style: "currency",
                          currency: payment.currency,
                        }).format(payment.amount)}
                      </td>
                      <td className="px-3 py-3">{payment.status}</td>
                      <td className="px-3 py-3">{payment.provider ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                {payments.data.total} payments · fetched{" "}
                {new Date(payments.data.fetchedAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}
              </p>
              {payments.data.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={paymentsPage <= 1 || payments.isFetching}
                    onClick={() => setPaymentsPage(page => Math.max(1, page - 1))}
                  >
                    Previous
                  </button>
                  <span className="text-xs text-muted-foreground">
                    Page {payments.data.page} of {payments.data.totalPages}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={paymentsPage >= payments.data.totalPages || payments.isFetching}
                    onClick={() => setPaymentsPage(page => Math.min(payments.data.totalPages, page + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}
      <Panel
        title="Deduction rates"
        subtitle="Used when generating new statements. Saved statements retain their original amounts."
        action={
          canEdit && rates.isSuccess && !editing ? (
            <button className={buttonClass} onClick={() => setEditing(true)}>
              Edit rates
            </button>
          ) : undefined
        }
      >
        {rates.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : rates.isError ? (
          <ErrorState
            message={rates.error.message}
            onRetry={() => void rates.refetch()}
          />
        ) : editing && canEdit ? (
          <RateEditor
            key={scope.join(":")}
            rates={rates.data}
            queryKey={ratesKey}
            onClose={() => setEditing(false)}
          />
        ) : (
          <dl className="grid gap-4 sm:grid-cols-3">
            {rateFields.map(([key, label]) => (
              <div key={key}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {rates.data[key]}%
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>
    </div>
  )
}
