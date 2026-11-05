import PDFDocument from 'pdfkit';
import type { MothershipPayment } from './revenueTransaction.services';

export type MothershipPaymentExportRow = MothershipPayment & {
  payment_date: string;
  distributor_name: string | null;
  partner_name: string | null;
};

const columns = [
  'payment_date', 'txnid', 'device_id', 'game_id', 'amount', 'currency',
  'status', 'provider', 'qr_id', 'created_at', 'updated_at',
  'distributor_name', 'partner_name',
] as const;

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function mothershipPaymentsCsv(payments: MothershipPaymentExportRow[]): string {
  return [
    ['sr_no', ...columns, 'total_revenue'].join(','),
    ...payments.map((payment, index) => [
      index + 1,
      ...columns.map((column) => csvCell(column === 'amount' ? Math.abs(payment.amount).toFixed(2) : payment[column])),
      csvCell(Math.abs(payment.amount).toFixed(2)),
    ].join(',')),
  ].join('\r\n') + '\r\n';
}

export function mothershipPaymentsPdf(payments: MothershipPaymentExportRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const normalized = payments.map((payment) => ({ ...payment, amount: Math.abs(payment.amount) }));
    const total = normalized.reduce((sum, payment) => sum + payment.amount, 0);
    const document = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 32 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const widths = [36, 100, 88, 70, 60, 55, 58, 72, 80, 76, 88, 88, 92, 92, 80];
    const labels = ['Sr. No.', 'Transaction ID', 'Device ID', 'Game', 'Amount', 'Currency', 'Status', 'Provider', 'QR ID', 'Date', 'Created', 'Updated', 'Distributor', 'Partner', 'Total Amount'];
    const left = 32, rowHeight = 22, bottom = 780;
    const tableWidth = widths.reduce((sum, width) => sum + width, 0);
    const drawHeader = () => {
      document.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text('Mothership Payment Feed', left, 30);
      document.font('Helvetica').fontSize(10).fillColor('#4B5563').text(`Records: ${normalized.length} | Total Amount: ${total.toFixed(2)} | Generated: ${new Date().toISOString()}`, left, 56);
    };
    const drawTableHeader = (y: number) => {
      let x = left;
      document.rect(left, y - 3, tableWidth, rowHeight).fill('#E5E7EB');
      document.font('Helvetica-Bold').fontSize(8).fillColor('#111827');
      labels.forEach((label, index) => { const width = widths[index]!; document.text(label, x + 4, y + 4, { width: width - 8, height: rowHeight - 6, ellipsis: true, lineBreak: false }); x += width; });
    };
    const drawRow = (payment: MothershipPaymentExportRow, index: number, y: number, shaded: boolean) => {
      let x = left;
      if (shaded) document.rect(left, y - 3, tableWidth, rowHeight).fill('#F9FAFB');
      const amount = Math.abs(payment.amount).toFixed(2);
      const values = [index + 1, payment.txnid, payment.device_id, payment.game_id, amount, payment.currency, payment.status, payment.provider, payment.qr_id, payment.payment_date, payment.created_at, payment.updated_at, payment.distributor_name, payment.partner_name, amount];
      document.font('Helvetica').fontSize(8).fillColor('#111827');
      values.forEach((value, valueIndex) => { const width = widths[valueIndex]!; document.text(value == null ? '' : String(value), x + 4, y + 4, { width: width - 8, height: rowHeight - 6, ellipsis: true, lineBreak: false }); x += width; });
    };
    const drawTotal = (y: number) => {
      let x = left;
      document.rect(left, y - 3, tableWidth, rowHeight).fill('#D1D5DB');
      const values = ['', '', '', 'TOTAL AMOUNT', total.toFixed(2), '', '', '', '', '', '', '', '', '', total.toFixed(2)];
      document.font('Helvetica-Bold').fontSize(8).fillColor('#111827');
      values.forEach((value, index) => { const width = widths[index]!; document.text(value, x + 4, y + 4, { width: width - 8, height: rowHeight - 6, ellipsis: true, lineBreak: false }); x += width; });
    };
    drawHeader();
    let y = 86;
    drawTableHeader(y); y += rowHeight;
    normalized.forEach((payment, index) => { if (y > bottom) { document.addPage(); drawHeader(); y = 86; drawTableHeader(y); y += rowHeight; } drawRow(payment, index, y, index % 2 === 1); y += rowHeight; });
    if (y > bottom - rowHeight) { document.addPage(); drawHeader(); y = 86; drawTableHeader(y); y += rowHeight; }
    drawTotal(y); document.end();
  });
}
