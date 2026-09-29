import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env';

export const INVOICES_DIR = path.resolve(env.INVOICES_DIR ?? path.join(process.cwd(), 'invoices'));
fs.mkdirSync(INVOICES_DIR, { recursive: true });

const assets = fileURLToPath(new URL('../../assets/', import.meta.url));
const colors = {
  navy: '#000519', ink: '#172033', muted: '#687386', line: '#E2E6ED',
  light: '#F5F7FA', violet: '#6B36CE', lavender: '#F2ECFC', cyan: '#00C9E3',
};
const money = (value: number) => '₹ ' + new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

interface InvoiceData {
  orderNumber: string;
  parentOrgName: string;
  childOrgName: string;
  quantity: number;
  depositPerMachine: number;
  nonRefundablePerMachine: number;
  totalDeposit: number;
  totalNonRefundable: number;
  taxAmount: number;
  grandTotal: number;
  date: Date;
}

// Both emailed files and downloads use the same layout and stored order amounts.
// Rendering into a buffer also keeps concurrent downloads independent.
export const renderInvoicePDF = (data: InvoiceData): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 44,
      info: { Title: 'Order invoice ' + data.orderNumber, Author: 'ArcadeLX', Creator: 'ArcadeLX' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      doc.registerFont('Regular', path.join(assets, 'fonts/Lato-Regular.ttf'));
      doc.registerFont('Bold', path.join(assets, 'fonts/Lato-Bold.ttf'));
      const pageWidth = doc.page.width;
      const left = 44;
      const right = pageWidth - left;
      const width = right - left;

      function text(value: string, x: number, y: number, textWidth: number,
        size = 10, color = colors.ink, bold = false, align: 'left' | 'right' | 'center' = 'left') {
        doc.font(bold ? 'Bold' : 'Regular').fontSize(size).fillColor(color)
          .text(value, x, y, { width: textWidth, align, lineGap: 3 });
      }
      function fitted(value: string, x: number, y: number, textWidth: number,
        size: number, color = colors.ink, bold = false) {
        doc.font(bold ? 'Bold' : 'Regular').fontSize(size);
        while (doc.widthOfString(value) > textWidth && size > 8) doc.fontSize(--size);
        text(value, x, y, textWidth, size, color, bold, 'right');
      }
      function line(y: number) {
        doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(colors.line).stroke();
      }

      doc.rect(0, 0, pageWidth, 130).fill(colors.navy);
      doc.rect(0, 0, pageWidth / 2, 3).fill(colors.cyan);
      doc.rect(pageWidth / 2, 0, pageWidth / 2, 3).fill(colors.violet);
      doc.image(path.join(assets, 'invoice-logo.png'), left, 35, { width: 215 });
      text('KIOSK ORDER', left, 90, 220, 8, '#B4C0D6', true);
      text('Order invoice', 310, 39, right - 310, 25, '#FFFFFF', true, 'right');
      fitted(data.orderNumber, 310, 82, right - 310, 10, '#D5DBE9');

      const issued = new Intl.DateTimeFormat('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
      }).format(data.date);
      text('ISSUED ON', left, 157, 160, 8, colors.muted, true);
      text(issued, left, 174, 160, 11, colors.ink, true);
      text('ORDER QUANTITY', 235, 157, 140, 8, colors.muted, true);
      text(data.quantity + (data.quantity === 1 ? ' kiosk' : ' kiosks'), 235, 174, 140, 11, colors.ink, true);
      text('CURRENCY', 430, 157, right - 430, 8, colors.muted, true, 'right');
      text('INR / Indian rupee', 400, 174, right - 400, 11, colors.ink, true, 'right');
      line(204);

      const partyWidth = (width - 36) / 2;
      const billX = left + partyWidth + 36;
      text('SUPPLIER', left, 229, partyWidth, 8, colors.muted, true);
      text('BILLED TO', billX, 229, partyWidth, 8, colors.muted, true);
      const namesY = 248;
      doc.font('Bold').fontSize(13);
      const namesHeight = Math.max(34,
        doc.heightOfString(data.parentOrgName, { width: partyWidth, lineGap: 3 }),
        doc.heightOfString(data.childOrgName, { width: partyWidth, lineGap: 3 }));
      text(data.parentOrgName, left, namesY, partyWidth, 13, colors.ink, true);
      text(data.childOrgName, billX, namesY, partyWidth, 13, colors.ink, true);

      // Show both financial components with their saved quantities, rates and totals.
      const sectionY = namesY + namesHeight + 28;
      text('Order summary', left, sectionY, 220, 15, colors.ink, true);
      text('ALL AMOUNTS IN INR', right - 180, sectionY + 5, 180, 8, colors.muted, false, 'right');
      const tableY = sectionY + 34;
      doc.roundedRect(left, tableY, width, 34, 5).fill(colors.light);
      const qtyX = 265;
      const rateX = 313;
      const amountX = 433;
      text('DESCRIPTION', left + 14, tableY + 12, 180, 8, colors.muted, true);
      text('QTY', qtyX, tableY + 12, 30, 8, colors.muted, true, 'center');
      text('UNIT RATE', rateX, tableY + 12, 100, 8, colors.muted, true, 'right');
      text('AMOUNT', amountX, tableY + 12, right - amountX - 14, 8, colors.muted, true, 'right');

      function charge(y: number, title: string, rate: number, total: number) {
        text(title, left + 14, y + 17, 200, 10.5, colors.ink, true);
        text('Per kiosk', left + 14, y + 35, 180, 8.5, colors.muted);
        text(String(data.quantity), qtyX, y + 22, 30, 10, colors.ink, false, 'center');
        fitted(money(rate), rateX, y + 22, 100, 10);
        fitted(money(total), amountX, y + 22, right - amountX - 14, 10, colors.ink, true);
        line(y + 63);
      }
      charge(tableY + 34, 'Deposit', data.depositPerMachine, data.totalDeposit);
      charge(tableY + 98, 'Non-refundable fee', data.nonRefundablePerMachine, data.totalNonRefundable);

      const totalsY = tableY + 186;
      text('TAX DETAILS', left, totalsY + 2, 180, 8, colors.muted, true);
      text('18% GST applies to the\nnon-refundable fee only.', left, totalsY + 20, 190, 9, colors.muted);
      const summaryX = 305;
      text('Subtotal', summaryX, totalsY, 100, 10, colors.muted);
      fitted(money(data.totalDeposit + data.totalNonRefundable), 405, totalsY, right - 405, 10, colors.ink, true);
      text('GST (18%)', summaryX, totalsY + 27, 100, 10, colors.muted);
      fitted(money(data.taxAmount), 405, totalsY + 27, right - 405, 10, colors.ink, true);
      const totalBoxY = totalsY + 56;
      doc.roundedRect(summaryX - 14, totalBoxY, right - summaryX + 14, 82, 8).fill(colors.lavender);
      text('GRAND TOTAL', summaryX + 2, totalBoxY + 15, 200, 8, colors.violet, true);
      fitted(money(data.grandTotal), summaryX + 2, totalBoxY + 36, right - summaryX - 18, 24, colors.violet, true);

      line(765);
      text('ArcadeLX', left, 784, 110, 9, colors.ink, true);
      text('Order reference: ' + data.orderNumber, left + 115, 784, width - 180, 8, colors.muted);
      text('1 / 1', right - 45, 784, 45, 8, colors.muted, false, 'right');
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });

export const generateInvoicePDF = async (data: InvoiceData): Promise<string> => {
  const filename = data.orderNumber + '.pdf';
  const filePath = path.resolve(INVOICES_DIR, filename);
  if (path.dirname(filePath) !== INVOICES_DIR) throw new Error('Invalid invoice filename');
  await fs.promises.writeFile(filePath, await renderInvoicePDF(data));
  return filename;
};
