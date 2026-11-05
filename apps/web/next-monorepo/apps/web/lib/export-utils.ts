import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(",")).join("\r\n")
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadPdf(filename: string, title: string, headers: string[], rows: unknown[][], numericColumns: number[] = []) {
  const document = new jsPDF({ orientation: headers.length > 6 ? "landscape" : "portrait" })
  document.setFillColor(15, 23, 42); document.rect(0, 0, document.internal.pageSize.getWidth(), 24, "F")
  document.setTextColor(255, 255, 255); document.setFontSize(15); document.setFont("helvetica", "bold"); document.text(title, 14, 15)
  document.setFont("helvetica", "normal"); document.setFontSize(8); document.text(`Generated ${new Date().toLocaleString("en-IN")}`, document.internal.pageSize.getWidth() - 14, 15, { align: "right" })
  document.setTextColor(15, 23, 42)
  autoTable(document, { head: [headers], body: rows.map(row => row.map(value => value == null ? "" : String(value))), startY: 30, margin: { left: 14, right: 14 }, theme: "grid", styles: { fontSize: 8, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.1 }, columnStyles: Object.fromEntries(numericColumns.map(index => [index, { halign: "right" as const }])), headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold" }, alternateRowStyles: { fillColor: [248, 250, 252] }, didDrawPage: ({ pageNumber }) => { document.setFontSize(8); document.setTextColor(100, 116, 139); document.text(`ArcadeLX · Page ${pageNumber}`, 14, document.internal.pageSize.getHeight() - 8) } })
  document.save(filename)
}
