"use client"

import React, { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Download, ExternalLink, FileText, RefreshCw, Search, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"
import { useMe } from "@/hooks/useMe"
import {
  fetchDeductionRates,
  fetchMachineRevenue,
  fetchMothershipPayments,
  downloadMothershipPaymentsExport,
  openMothershipPaymentsInGoogleSheets,
  syncMothershipPayments,
  updateDeductionRates,
  type DeductionRates,
} from "@/lib/backend-api"
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
} from "@/components/dashboard/ui"
import RevenueTrendChart from "@/components/dashboard/RevenueTrendChart"
import { downloadCsv, downloadPdf } from "@/lib/export-utils"

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
})
const buttonClass =
  "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
const selectClass = `${inputClass} sm:w-auto sm:min-w-36`
const PAGE_SIZE = 10
const PAYMENT_SYNC_INTERVAL_MS = 60_000
type RevenuePeriod = "today" | "thisMonth" | "totalRevenue"
function istDateKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}
const rateFields = [
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
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [machineSort, setMachineSort] = useState<"totalRevenue" | "thisMonth" | "today" | "machineCode">("totalRevenue")
  const [selectedPeriod, setSelectedPeriod] = useState<RevenuePeriod | null>(null)
  const [machinePage, setMachinePage] = useState(1)
  const [editing, setEditing] = useState(false)
  const [paymentsPage, setPaymentsPage] = useState(1)
  const [paymentSearch, setPaymentSearch] = useState("")
  const [paymentStatus, setPaymentStatus] = useState("")
  const [paymentDevice, setPaymentDevice] = useState("")
  const [paymentGame, setPaymentGame] = useState("")
  const [paymentProvider, setPaymentProvider] = useState("")
  const [paymentFrom, setPaymentFrom] = useState("")
  const [paymentTo, setPaymentTo] = useState("")
  const [paymentSort, setPaymentSort] = useState<"date" | "amount">("date")
  const [paymentSortDesc, setPaymentSortDesc] = useState(true)
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
    queryKey: ["mothership-payments", ...scope],
    queryFn: ({ signal }) => fetchMothershipPayments(1, signal, 50),
    enabled: canEdit,
    staleTime: 30_000,
    retry: 1,
  })
  const {
    mutate: syncPaymentsMutate,
    isPending: syncPaymentsPending,
    isError: syncPaymentsIsError,
  } = useMutation({
    mutationFn: syncMothershipPayments,
    onSuccess: (result) => {
      setPaymentsPage(1)
      void queryClient.invalidateQueries({ queryKey: ["revenue-machines", ...scope] })
      void queryClient.invalidateQueries({ queryKey: ["revenue-series", ...scope] })
      void queryClient.invalidateQueries({ queryKey: ["mothership-payments", ...scope] })
      const linked = result.devices?.newKiosksCreated ?? 0
      if (result.transactions.newRecordsInserted > 0 || linked > 0) {
        toast.success(`${result.transactions.newRecordsInserted} new payment${result.transactions.newRecordsInserted === 1 ? "" : "s"} imported${linked ? `; ${linked} device${linked === 1 ? "" : "s"} linked` : ""}`)
      }
    },
  })
  const csvPaymentExport = useMutation({ mutationFn: () => downloadMothershipPaymentsExport("csv"), onSuccess: () => toast.success("Mothership payments CSV downloaded"), onError: (error: Error) => toast.error(error.message) })
  const pdfPaymentExport = useMutation({ mutationFn: () => downloadMothershipPaymentsExport("pdf"), onSuccess: () => toast.success("Mothership payments PDF downloaded"), onError: (error: Error) => toast.error(error.message) })
  const googleSheetPaymentExport = useMutation({ mutationFn: openMothershipPaymentsInGoogleSheets, onSuccess: () => toast.success("CSV copied. Paste it into the opened Google Sheet."), onError: (error: Error) => toast.error(error.message) })
  const syncPendingRef = React.useRef(syncPaymentsPending)
  React.useEffect(() => {
    syncPendingRef.current = syncPaymentsPending
  }, [syncPaymentsPending])
  const runAutomaticPaymentSync = React.useCallback(() => {
    if (!syncPendingRef.current) syncPaymentsMutate()
  }, [syncPaymentsMutate])
  React.useEffect(() => {
    if (!canEdit) return
    runAutomaticPaymentSync()
    const interval = window.setInterval(runAutomaticPaymentSync, PAYMENT_SYNC_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [canEdit, runAutomaticPaymentSync])
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
  const periodMetrics = (["today", "thisMonth", "totalRevenue"] as const).map((key) => {
    const gross = rows.reduce((sum, row) => sum + Math.round(row[key] * 100), 0) / 100
    if (!rates.data) return { gross, estimatedNet: null, deductions: null }
    const gateway = Math.round(gross * rates.data.pgFeePercentage) / 100
    const beforeTds = gross - gateway
    const tds = Math.round(beforeTds * rates.data.tdsPercentage) / 100
    return { gross, estimatedNet: beforeTds - tds, deductions: gateway + tds }
  })
  const periodRows = selectedPeriod
    ? rows.filter((row) => row[selectedPeriod] > 0)
    : rows
  const filtered = periodRows.filter((row) => [row.machineCode, row.location, row.distributor, row.partner].some((value) => value.toLowerCase().includes(search.trim().toLowerCase())))
  const sortedMachines = [...filtered].sort((a, b) => machineSort === "machineCode" ? a.machineCode.localeCompare(b.machineCode) : b[machineSort] - a[machineSort])
  const machinePages = Math.max(1, Math.ceil(sortedMachines.length / PAGE_SIZE))
  const visibleMachines = sortedMachines.slice((machinePage - 1) * PAGE_SIZE, machinePage * PAGE_SIZE)
  const feed = payments.data?.payments ?? []
  const unique = (field: "status" | "device_id" | "game_id" | "provider") => [...new Set(feed.map(payment => payment[field]).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
  const normalizedPaymentSearch = paymentSearch.trim().toLowerCase()
  const filteredPayments = feed.filter((payment) => {
    const day = istDateKey(payment.created_at)
    return (!paymentStatus || payment.status.toLowerCase() === paymentStatus.toLowerCase()) && (!paymentDevice || payment.device_id === paymentDevice) && (!paymentGame || payment.game_id === paymentGame) && (!paymentProvider || payment.provider === paymentProvider) && (!paymentFrom || day >= paymentFrom) && (!paymentTo || day <= paymentTo) && (!normalizedPaymentSearch || `${payment.txnid} ${payment.device_id} ${payment.game_id} ${payment.provider ?? ""}`.toLowerCase().includes(normalizedPaymentSearch))
  }).sort((a, b) => {
    const comparison = paymentSort === "amount" ? a.amount - b.amount : Date.parse(a.created_at) - Date.parse(b.created_at)
    return paymentSortDesc ? -comparison : comparison
  })
  const paymentPages = Math.max(1, Math.ceil(filteredPayments.length / PAGE_SIZE))
  const visiblePayments = filteredPayments.slice((paymentsPage - 1) * PAGE_SIZE, paymentsPage * PAGE_SIZE)
  const resetPaymentFilters = () => { setPaymentSearch(""); setPaymentStatus(""); setPaymentDevice(""); setPaymentGame(""); setPaymentProvider(""); setPaymentFrom(""); setPaymentTo(""); setPaymentsPage(1) }
  const refreshing =
    revenue.isFetching || rates.isFetching || payments.isFetching || syncPaymentsPending
  const revenueExportHeaders = ["Machine", "Location", "Distributor", "Partner", "Today", "This month", "All time"]
  const revenueExportRows = filtered.map(row => [row.machineCode, row.location, row.distributor, row.partner, row.today, row.thisMonth, row.totalRevenue])
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">ArcadeLX · Finance</p>
          <h1 className="text-3xl font-semibold tracking-tight">Revenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fleet performance and payment activity · Figures use India Standard Time (IST)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={!filtered.length} onClick={() => downloadCsv("revenue.csv", revenueExportHeaders, revenueExportRows)}><span className="flex items-center gap-2"><Download size={16} /> CSV</span></button>
          <button className={buttonClass} disabled={!filtered.length} onClick={() => downloadPdf("revenue.pdf", "Machine Revenue", revenueExportHeaders, revenueExportRows)}><span className="flex items-center gap-2"><FileText size={16} /> PDF</span></button>
          <button
            className={buttonClass}
            disabled={refreshing || editing}
            onClick={() => {
              void revenue.refetch()
              void rates.refetch()
              if (canEdit) void payments.refetch()
              void queryClient.invalidateQueries({ queryKey: ["revenue-series", ...scope] })
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
        <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-32"/><Skeleton className="h-32"/><Skeleton className="h-32"/></div>
      ) : revenue.isError ? (
        <ErrorState
          message={revenue.error.message}
          onRetry={() => void revenue.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {([ ["Today’s gross", "IST calendar day", "today"], ["This month gross", "IST calendar month", "thisMonth"], ["All-time gross", `${rows.length} tracked machines`, "totalRevenue"] ] as const).map(([title, detail, period], index) => {
              const isSelected = selectedPeriod === period
              return (
              <button
                type="button"
                key={title}
                aria-pressed={isSelected}
                onClick={() => {
                  const nextPeriod = isSelected ? null : period
                  setSelectedPeriod(nextPeriod)
                  setMachinePage(1)
                  if (nextPeriod) setMachineSort(nextPeriod)
                }}
                className={`relative overflow-hidden rounded-xl border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "border-primary ring-2 ring-primary/30" : "border-border"} ${index === 0 && !isSelected ? "border-t-2 border-t-primary" : ""}`}
              >
                <p className="text-sm font-medium text-muted-foreground">{title}</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{money.format(periodMetrics[index]!.gross)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
                <div className="mt-4 border-t border-border/70 pt-3">
                  <p className="text-xs text-muted-foreground">Estimated after all deduction rates</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{periodMetrics[index]!.estimatedNet === null ? "Rates unavailable" : money.format(periodMetrics[index]!.estimatedNet)}</p>
                  {periodMetrics[index]!.deductions !== null && <p className="mt-1 text-xs text-muted-foreground">Estimated deductions: {money.format(periodMetrics[index]!.deductions!)}</p>}
                </div>
              </button>
              )
            })}
          </div>
          {rates.isSuccess && <p className="-mt-3 text-xs text-muted-foreground">Estimate applies gateway fees to gross, then estimates TDS on the remaining amount. GST is not charged. Actual TDS and payouts vary by distributor/partner agreements; finalized statements are authoritative.</p>}
          <RevenueTrendChart />
          <Panel title="Machine revenue" subtitle={`${filtered.length} ${selectedPeriod ? `${selectedPeriod === "today" ? "today" : selectedPeriod === "thisMonth" ? "this-month" : "all-time"} revenue machines` : "machines"} · gross recognized revenue by assignment window`}>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1"><label htmlFor="revenue-search" className="mb-1.5 block text-xs font-medium text-muted-foreground">Find a machine</label><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/><input id="revenue-search" className={`${inputClass} pl-9`} placeholder="Machine, location, distributor or partner" value={search} onChange={(event) => { setSearch(event.target.value); setMachinePage(1) }}/></div></div>
              <div><label htmlFor="machine-sort" className="mb-1.5 block text-xs font-medium text-muted-foreground">Sort machines</label><select id="machine-sort" className={selectClass} value={machineSort} onChange={(event) => { setMachineSort(event.target.value as typeof machineSort); setMachinePage(1) }}><option value="totalRevenue">All-time revenue</option><option value="thisMonth">This month</option><option value="today">Today</option><option value="machineCode">Machine ID</option></select></div>
            </div>
            {!rows.length ? (
              <EmptyState message="No machine revenue to show yet." />
            ) : !filtered.length ? (
              <EmptyState message={selectedPeriod ? "No machines recorded revenue for this period." : "No machines match your search."} />
            ) : (
              <>
              <div className="overflow-x-auto rounded-lg border border-border/70">
                <table className="w-full min-w-[860px] text-sm whitespace-nowrap">
                  <caption className="sr-only">
                    Gross revenue by machine in INR
                  </caption>
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
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
                    {visibleMachines.map((row) => (
                      <tr
                        key={row.machineCode}
                        className="border-b border-border/60 transition-colors hover:bg-muted/25 last:border-0"
                      >
                        <th
                          scope="row"
                          className="px-3 py-3 text-left font-medium"
                        >
                          <span title={row.machineCode} className="inline-block max-w-40 truncate align-bottom">{row.machineCode}</span>
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
              {filtered.length > PAGE_SIZE && <div className="mt-4 flex items-center justify-between border-t border-border pt-3"><span className="text-xs text-muted-foreground">Showing {(machinePage - 1) * PAGE_SIZE + 1}–{Math.min(machinePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span><div className="flex gap-2"><button className={buttonClass} disabled={machinePage <= 1} onClick={() => setMachinePage(page => page - 1)}>Previous</button><span className="self-center text-xs text-muted-foreground">{machinePage} / {machinePages}</span><button className={buttonClass} disabled={machinePage >= machinePages} onClick={() => setMachinePage(page => page + 1)}>Next</button></div></div>}
              </>
            )}
          </Panel>
        </>
      )}
      {canEdit && (
        <Panel title="Mothership payment feed" subtitle="Latest 50 upstream records · Automatically synchronized every 60 seconds" className="border-primary/20">
          {syncPaymentsIsError && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              Payment synchronization failed. The local ledger was not confirmed as updated; retry when the service is available.
            </p>
          )}
          {payments.isPending ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full"/><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full"/></div>
          ) : payments.isError && !payments.data ? (
            <ErrorState
              message="Couldn't refresh the Mothership feed. Try again."
              onRetry={() => void payments.refetch()}
            />
          ) : !payments.data.payments.length ? (
            <EmptyState message="No payments were returned by Mothership." />
          ) : (
            <>
            {payments.isError && payments.data && <p role="status" className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">Refresh failed. Showing the last successfully fetched feed below.</p>}
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border/70 bg-background/60 p-3">
              <div className="min-w-44 flex-1"><label htmlFor="payment-search" className="mb-1 block text-xs font-medium text-muted-foreground">Search the latest feed</label><input id="payment-search" className={inputClass} placeholder="Transaction, device, game or provider" value={paymentSearch} onChange={e => { setPaymentSearch(e.target.value); setPaymentsPage(1) }}/></div>
              {([["payment-status", "Status", paymentStatus, setPaymentStatus, unique("status")], ["payment-device", "Device", paymentDevice, setPaymentDevice, unique("device_id")], ["payment-game", "Game", paymentGame, setPaymentGame, unique("game_id")], ["payment-provider", "Provider", paymentProvider, setPaymentProvider, unique("provider")]] as const).map(([id, label, value, setter, options]) => <div key={id}><label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label><select id={id} className={selectClass} value={value} onChange={e => { setter(e.target.value); setPaymentsPage(1) }}><option value="">All {label.toLowerCase()}s</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></div>)}
              <div><label htmlFor="payment-from" className="mb-1 block text-xs font-medium text-muted-foreground">From (IST)</label><input id="payment-from" className={selectClass} type="date" value={paymentFrom} onChange={e => { setPaymentFrom(e.target.value); setPaymentsPage(1) }}/></div>
              <div><label htmlFor="payment-to" className="mb-1 block text-xs font-medium text-muted-foreground">To (IST)</label><input id="payment-to" className={selectClass} type="date" value={paymentTo} onChange={e => { setPaymentTo(e.target.value); setPaymentsPage(1) }}/></div>
              <button className={`${buttonClass} inline-flex items-center gap-1.5`} onClick={resetPaymentFilters}><SlidersHorizontal size={14}/>Reset filters</button>
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{filteredPayments.length} matching records in latest {payments.data.total} · fetched {new Date(payments.data.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span><div className="flex flex-wrap items-center gap-2"><label htmlFor="payment-sort">Sort by</label><select id="payment-sort" className={`${selectClass} py-1.5`} value={paymentSort} onChange={e => { setPaymentSort(e.target.value as typeof paymentSort); setPaymentsPage(1) }}><option value="date">Payment date</option><option value="amount">Amount</option></select><button className="rounded-md border border-border p-1.5 hover:bg-muted" aria-label={paymentSortDesc ? "Descending sort; reverse order" : "Ascending sort; reverse order"} onClick={() => setPaymentSortDesc(value => !value)}>{paymentSortDesc ? <ArrowDownWideNarrow size={15}/> : <ArrowUpWideNarrow size={15}/>}</button><button type="button" className={buttonClass} disabled={csvPaymentExport.isPending} onClick={() => csvPaymentExport.mutate()}>{csvPaymentExport.isPending ? "Exporting…" : <><Download size={14} className="mr-1 inline" />CSV</>}</button><button type="button" className={buttonClass} disabled={pdfPaymentExport.isPending} onClick={() => pdfPaymentExport.mutate()}>{pdfPaymentExport.isPending ? "Exporting…" : <><FileText size={14} className="mr-1 inline" />PDF</>}</button><button type="button" className={buttonClass} disabled={googleSheetPaymentExport.isPending} onClick={() => googleSheetPaymentExport.mutate()}>{googleSheetPaymentExport.isPending ? "Opening…" : <><ExternalLink size={14} className="mr-1 inline" />Google Sheet</>}</button></div></div>
            {!filteredPayments.length ? <EmptyState message="No payments match these filters. Adjust or reset the filters to explore the latest feed."/> : <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[800px] text-sm whitespace-nowrap">
                <caption className="sr-only">
                  Mothership payment records. Payment statuses are not revenue totals.
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                    {["Date", "Transaction", "Device", "Game", "Amount", "Status", "Provider", "Distributor", "Partner"].map(
                      (label) => (
                        <th scope="col" key={label} className="px-3 py-3 font-medium">
                          {label}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments.map((payment) => (
                    <tr
                      key={payment.txnid}
                      className="border-b border-border/60 transition-colors hover:bg-muted/25 last:border-0"
                    >
                      <td className="px-3 py-3">
                        {new Date(payment.created_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <th scope="row" className="px-3 py-3 text-left font-medium">
                        <span className="inline-block max-w-44 truncate align-bottom" title={payment.txnid}>{payment.txnid}</span>
                      </th>
                      <td className="px-3 py-3"><span className="inline-block max-w-36 truncate align-bottom" title={payment.device_id}>{payment.device_id || "Unknown device"}</span></td>
                      <td className="px-3 py-3"><span className="inline-block max-w-40 truncate align-bottom" title={payment.game_id}>{payment.game_id || "Unknown game"}</span></td>
                      <td className="px-3 py-3 tabular-nums">
                        {new Intl.NumberFormat("en-IN", {
                          style: "currency",
                          currency: payment.currency,
                        }).format(payment.amount)}
                      </td>
                      <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${payment.status.toLowerCase() === "completed" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : payment.status.toLowerCase() === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : payment.status.toLowerCase() === "expired" || payment.status.toLowerCase() === "failed" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground"}`}>{payment.status}</span></td>
                      <td className="px-3 py-3">{payment.provider ?? "—"}</td>
                      <td className="px-3 py-3">{payment.distributor_name ?? "—"}</td>
                      <td className="px-3 py-3">{payment.partner_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredPayments.length > PAGE_SIZE && (
                <div className="mt-4 grid grid-cols-1 items-center gap-3 border-t border-border px-1 pb-1 pt-4 sm:grid-cols-[1fr_auto_auto_auto]">
                  <span className="text-xs text-muted-foreground">Showing {(paymentsPage - 1) * PAGE_SIZE + 1}–{Math.min(paymentsPage * PAGE_SIZE, filteredPayments.length)} of {filteredPayments.length} matching</span>
                  <button
                    type="button"
                    className={`${buttonClass} justify-self-start sm:justify-self-auto`}
                    disabled={paymentsPage <= 1}
                    onClick={() => setPaymentsPage(page => Math.max(1, page - 1))}
                  >
                    Previous
                  </button>
                  <span className="text-center text-xs text-muted-foreground">
                    Page {paymentsPage} of {paymentPages}
                  </span>
                  <button
                    type="button"
                    className={`${buttonClass} justify-self-start sm:justify-self-end`}
                    disabled={paymentsPage >= paymentPages}
                    onClick={() => setPaymentsPage(page => Math.min(paymentPages, page + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>}
            </>
          )}
        </Panel>
      )}
      <Panel
        title="Deduction rates"
        subtitle="Current rates used for new statements. Existing statements retain their saved amounts."
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
          <dl className="grid gap-3 sm:grid-cols-3">
            {rateFields.map(([key, label], index) => (
              <div key={key} className={`rounded-lg border border-border/70 bg-background/60 p-4 ${index === 0 ? "sm:border-l-2 sm:border-l-primary" : ""}`}>
                <dt className="text-sm font-medium">{label.replace(" (%)", "")}</dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums">{rates.data[key]}<span className="ml-0.5 text-base text-muted-foreground">%</span></dd>
                <p className="mt-1 text-xs text-muted-foreground">{key === "pgFeePercentage" ? "Payment gateway fee rate" : "Tax Deducted at Source rate"}</p>
              </div>
            ))}
          </dl>
        )}
      </Panel>
    </div>
  )
}
