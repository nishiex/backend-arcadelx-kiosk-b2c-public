import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/env';

// Ensure the directory exists when the server starts
export const INVOICES_DIR = path.resolve(env.INVOICES_DIR ?? path.join(process.cwd(), 'invoices'));
if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

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

export const generateInvoicePDF = (data: InvoiceData): Promise<string> => {
  return new Promise((resolve, reject) => {
    const filename = `${data.orderNumber}.pdf`;
    const filePath = path.join(INVOICES_DIR, filename);

    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // Header
    doc.fontSize(20).text('ORDER INVOICE', { align: 'center' }).moveDown();
    doc.fontSize(10).text(`Order Number: ${data.orderNumber}`);
    doc.text(`Date: ${data.date.toLocaleDateString()}`).moveDown();

    // Parties
    doc.fontSize(12).text('Supplier:', { underline: true });
    doc.fontSize(10).text(data.parentOrgName).moveDown();
    
    doc.fontSize(12).text('Billed To:', { underline: true });
    doc.fontSize(10).text(data.childOrgName).moveDown(2);

    // Breakdown Table
    doc.fontSize(12).text('Financial Breakdown', { underline: true }).moveDown();
    doc.fontSize(10);
    doc.text(`Quantity: ${data.quantity} Kiosks`);
    doc.text(`Deposit per Machine: ₹${data.depositPerMachine.toFixed(2)}`);
    doc.text(`Non-Refundable Fee per Machine: ₹${data.nonRefundablePerMachine.toFixed(2)}`).moveDown();

    doc.text(`Total Deposit: ₹${data.totalDeposit.toFixed(2)}`);
    doc.text(`Total Non-Refundable: ₹${data.totalNonRefundable.toFixed(2)}`);
    doc.text(`Tax (18% GST on Non-Refundable): ₹${data.taxAmount.toFixed(2)}`).moveDown();

    doc.font('Helvetica-Bold').fontSize(14).text(`GRAND TOTAL: ₹${data.grandTotal.toFixed(2)}`);

    doc.end();

    stream.on('finish', () => {
      resolve(filename);
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
};
