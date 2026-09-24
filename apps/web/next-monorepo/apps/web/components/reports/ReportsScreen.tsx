"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { FileDown, FileText, Loader2, PieChart } from "lucide-react"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { fetchRevenueReport, fetchDistributors } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
})
const money = (n: number) => inr.format(n)

/** Last 12 months as selectable options, newest first. */
function monthOptions() {
  const opts: { year: number; month: number; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    opts.push({
      year: dt.getFullYear(),
      month: dt.getMonth() + 1,
      label: dt.toLocaleString("en-US", { month: "long", year: "numeric" }),
    })
  }
  return opts
}

export default function ReportsScreen() {
  const { isCompany } = useMe()
  const months = React.useMemo(monthOptions, [])
  const first = months[0]!
  const [applied, setApplied] = React.useState({ year: first.year, month: first.month, org: "" })

  const distributors = useQuery({
    queryKey: ["distributors"],
    queryFn: fetchDistributors,
    enabled: isCompany,
  })

  const report = useQuery({
    queryKey: ["revenueReport", applied.year, applied.month, applied.org],
    queryFn: () => fetchRevenueReport(applied.year, applied.month, applied.org || undefined),
  })

  const rows = report.data?.rows ?? []
  const totals = report.data?.totals
  const bodyRef = useReveal<HTMLTableSectionElement>([rows.length, applied.month])
  const activeLabel =
    months.find((m) => m.year === applied.year && m.month === applied.month)?.label ?? ""

  const exportCsv = () => {
    const header = [
      "Machine Code",
      "Partner Name",
      "Model Name",
      "Gross Revenue Before Tax",
      "Company Share",
      "Distributor Share",
    ]
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = rows.map((r) =>
      [
        esc(r.machineCode),
        esc(r.partner?.name ?? "Unassigned"),
        esc(r.model ?? ""),
        r.grossRevenue,
        r.companyShare,
        r.distributorShare,
      ].join(",")
    )
    const csv = [header.map(esc).join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `revenue-report-${applied.year}-${String(applied.month).padStart(2, "0")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Standard PDF fonts have no ₹ glyph, so format money as plain grouped numbers.
  const pdfNum = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
    const marginX = 40

    doc.setFontSize(16)
    doc.text("Revenue Report", marginX, 46)
    doc.setFontSize(10)
    doc.setTextColor(110)
    doc.text(
      `${activeLabel}${applied.org ? "" : "  ·  All Partners"}`,
      marginX,
      64
    )
    doc.setTextColor(0)

    autoTable(doc, {
      startY: 82,
      margin: { left: marginX, right: marginX },
      head: [[
        "Machine Code",
        "Partner Name",
        "Model Name",
        "Gross Revenue (Rs.)",
        "Company Share (Rs.)",
        "Distributor Share (Rs.)",
      ]],
      body: rows.map((r) => [
        r.machineCode,
        r.partner?.name ?? "Unassigned",
        r.model ?? "—",
        pdfNum.format(r.grossRevenue),
        pdfNum.format(r.companyShare),
        pdfNum.format(r.distributorShare),
      ]),
      foot: totals
        ? [[
            `Total · ${rows.length} kiosk${rows.length === 1 ? "" : "s"}`,
            "",
            "",
            pdfNum.format(totals.grossRevenue),
            pdfNum.format(totals.companyShare),
            pdfNum.format(totals.distributorShare),
          ]]
        : undefined,
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
    })

    doc.save(
      `revenue-report-${applied.year}-${String(applied.month).padStart(2, "0")}.pdf`
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue analytics for your {isCompany ? "distributor network" : "kiosks"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCompany && (
            <select
              className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              value={applied.org}
              onChange={(e) => setApplied((p) => ({ ...p, org: e.target.value }))}
            >
              <option value="">All Partners</option>
              {(distributors.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            value={`${applied.year}-${applied.month}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number)
              setApplied((p) => ({ ...p, year: y!, month: m! }))
            }}
          >
            {months.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                {m.label}
              </option>
            ))}
          </select>
          {report.isFetching && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
          <button
            onClick={exportPdf}
            disabled={!rows.length}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText size={16} /> Export PDF
          </button>
          <button
            onClick={exportCsv}
            disabled={!rows.length}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileDown size={16} /> Export CSV
          </button>
        </div>
      </div>

      {/* Report table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="hidden border-b border-border px-5 py-3 text-sm font-semibold print:block">
          Revenue report · {activeLabel}
        </div>
        {report.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : report.isError ? (
          <ErrorState className="py-12" message="Couldn't load the report." onRetry={() => report.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            className="py-14"
            icon={<PieChart size={30} />}
            message={`No revenue recorded for ${activeLabel}.`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Machine Code</th>
                  <th className="px-5 py-3 font-medium">Partner Name</th>
                  <th className="px-5 py-3 font-medium">Model Name</th>
                  <th className="px-5 py-3 text-right font-medium">Gross Revenue Before Tax</th>
                  <th className="px-5 py-3 text-right font-medium">Company Share</th>
                  <th className="px-5 py-3 text-right font-medium">Distributor Share</th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {rows.map((r) => (
                  <tr
                    key={r.kioskId}
                    data-reveal
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3 font-mono text-xs">{r.machineCode}</td>
                    <td className="px-5 py-3">
                      {r.partner?.name ?? <span className="italic text-muted-foreground">Unassigned</span>}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{r.model ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{money(r.grossRevenue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{money(r.companyShare)}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-primary">{money(r.distributorShare)}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    <td className="px-5 py-3" colSpan={3}>
                      Total · {rows.length} kiosk{rows.length === 1 ? "" : "s"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(totals.grossRevenue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(totals.companyShare)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-primary">{money(totals.distributorShare)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
