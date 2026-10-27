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

export function downloadPdf(filename: string, title: string, headers: string[], rows: unknown[][]) {
  const document = new jsPDF({ orientation: headers.length > 6 ? "landscape" : "portrait" })
  document.setFontSize(14)
  document.text(title, 14, 16)
  autoTable(document, { head: [headers], body: rows.map(row => row.map(value => value == null ? "" : String(value))), startY: 22, styles: { fontSize: 8 } })
  document.save(filename)
}
