import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export interface IpSettlementPdfRow {
  gameIdentifier: string;
  gameDisplayName: string;
  kioskCount: number;
  grossRevenue: number;
  gstAmount: number;
  pgFeeAmount: number;
  networkShare: number;
  companyShareBeforeRoyalty: number;
  ipRoyaltyShare: number;
}

export interface IpSettlementReportConfig {
  organizationName: string;
  legalName?: string;
  pan?: string;
  gstin?: string | null;
  month: number;
  year: number;
  totalKioskCount: number;
  totalGrossRevenue: number;
  totalGstAmount: number;
  totalPgFeeAmount: number;
  totalNetworkShare: number;
  totalCompanyShareBeforeRoyalty: number;
  totalIpRoyaltyShare: number;
  finalPayout: number;
  rows: IpSettlementPdfRow[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

export const resolveMonthName = (month: number): string => {
  return MONTH_NAMES[month - 1] || `Month ${month}`;
};

/**
 * Generates an official IP Royalty Monthly Settlement Statement PDF.
 *
 * File storage:
 * - Scalable structure: /uploads/reports/ip-settlements/YYYY-MM/
 * - Consistent naming: IP-SETTLEMENT-<orgSlug>-<year>-<month>.pdf
 * - Returns relative path for persistence in IpSettlement.pdfPath
 */
export const generateIpSettlementPdf = (config: IpSettlementReportConfig): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const monthStr = String(config.month).padStart(2, '0');
      const periodFolder = path.join('ip-settlements', `${config.year}-${monthStr}`);
      const reportsDir = path.join(process.cwd(), 'uploads', 'reports', periodFolder);

      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const orgSlug = config.organizationName
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'ip-party';

      const filename = `IP-SETTLEMENT-${orgSlug}-${config.year}-${monthStr}.pdf`;
      const absoluteFilePath = path.join(reportsDir, filename);

      const doc = new PDFDocument({ margin: 25, size: 'A4', layout: 'landscape' });
      const stream = fs.createWriteStream(absoluteFilePath);
      doc.pipe(stream);

      // --- Brand Header ---
      doc.fontSize(18).font('Helvetica-Bold').text('ARCADELX', 25, 25);
      doc.fontSize(8).font('Helvetica').fillColor('#666666').text('Nilee Games and Future Technologies Pvt. Ltd.', 25, 45);

      doc.fontSize(14).font('Helvetica-Bold').fillColor('#111827').text('IP ROYALTY REVENUE STATEMENT', 450, 25, { align: 'right' });
      doc.fontSize(10).font('Helvetica').fillColor('#4B5563').text(`Period: ${resolveMonthName(config.month)} ${config.year}`, 450, 42, { align: 'right' });
      doc.fontSize(8).text(`Generated: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`, 450, 56, { align: 'right' });

      doc.moveTo(25, 70).lineTo(815, 70).lineWidth(1).strokeColor('#E5E7EB').stroke();

      // --- IP Party Details Card ---
      doc.rect(25, 80, 790, 48).fillAndStroke('#F9FAFB', '#E5E7EB');
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#111827').text('IP Partner Details:', 35, 88);

      doc.font('Helvetica').fontSize(9).fillColor('#374151');
      doc.text(`Organization: ${config.organizationName}`, 35, 102);
      if (config.legalName) doc.text(`Legal Name: ${config.legalName}`, 250, 102);
      if (config.pan) doc.text(`PAN: ${config.pan}`, 480, 102);
      if (config.gstin) doc.text(`GSTIN: ${config.gstin}`, 650, 102);

      // --- High-level Summary Metrics Bar ---
      doc.rect(25, 136, 790, 44).fillAndStroke('#EFF6FF', '#BFDBFE');
      doc.fillColor('#1E40AF').fontSize(8).font('Helvetica-Bold');
      doc.text('TOTAL KIOSKS', 35, 144);
      doc.text('GROSS REVENUE', 140, 144);
      doc.text('GST DEDUCTED', 260, 144);
      doc.text('PG FEE', 380, 144);
      doc.text('NETWORK SHARE', 480, 144);
      doc.text('NILEE SHARE', 600, 144);
      doc.text('YOUR ROYALTY (PAYOUT)', 700, 144, { align: 'right', width: 105 });

      doc.fillColor('#1E3A8A').fontSize(11).font('Helvetica-Bold');
      doc.text(String(config.totalKioskCount), 35, 158);
      doc.text(`Rs. ${config.totalGrossRevenue.toFixed(2)}`, 140, 158);
      doc.text(`Rs. ${config.totalGstAmount.toFixed(2)}`, 260, 158);
      doc.text(`Rs. ${config.totalPgFeeAmount.toFixed(2)}`, 380, 158);
      doc.text(`Rs. ${config.totalNetworkShare.toFixed(2)}`, 480, 158);
      doc.text(`Rs. ${config.totalCompanyShareBeforeRoyalty.toFixed(2)}`, 600, 158);
      doc.fillColor('#047857').text(`Rs. ${config.totalIpRoyaltyShare.toFixed(2)}`, 700, 158, { align: 'right', width: 105 });

      // --- Game Breakdown Table Headers ---
      const tableTop = 192;
      doc.rect(25, tableTop, 790, 20).fill('#1F2937');
      doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');

      doc.text('Game Title', 32, tableTop + 6, { width: 150 });
      doc.text('Kiosks', 185, tableTop + 6, { width: 45, align: 'right' });
      doc.text('Gross Rev (Rs.)', 235, tableTop + 6, { width: 85, align: 'right' });
      doc.text('GST (Rs.)', 325, tableTop + 6, { width: 75, align: 'right' });
      doc.text('PG Fee (Rs.)', 405, tableTop + 6, { width: 75, align: 'right' });
      doc.text('Network Share (Rs.)', 485, tableTop + 6, { width: 100, align: 'right' });
      doc.text('Nilee Share (Rs.)', 590, tableTop + 6, { width: 100, align: 'right' });
      doc.text('Your Share (Rs.)', 695, tableTop + 6, { width: 110, align: 'right' });

      // --- Table Rows ---
      let y = tableTop + 24;
      doc.font('Helvetica').fontSize(8);

      config.rows.forEach((row, index) => {
        if (y > 510) {
          doc.addPage();
          y = 35;
        }

        // Alternating row background
        if (index % 2 === 1) {
          doc.rect(25, y - 3, 790, 16).fill('#F9FAFB');
        }

        doc.fillColor('#111827');
        const displayName = row.gameDisplayName || row.gameIdentifier;
        doc.text(displayName, 32, y, { width: 150, lineBreak: false });
        doc.text(String(row.kioskCount), 185, y, { width: 45, align: 'right' });
        doc.text(row.grossRevenue.toFixed(2), 235, y, { width: 85, align: 'right' });
        doc.text(row.gstAmount.toFixed(2), 325, y, { width: 75, align: 'right' });
        doc.text(row.pgFeeAmount.toFixed(2), 405, y, { width: 75, align: 'right' });
        doc.text(row.networkShare.toFixed(2), 485, y, { width: 100, align: 'right' });
        doc.text(row.companyShareBeforeRoyalty.toFixed(2), 590, y, { width: 100, align: 'right' });
        doc.fillColor('#047857').font('Helvetica-Bold')
          .text(row.ipRoyaltyShare.toFixed(2), 695, y, { width: 110, align: 'right' })
          .font('Helvetica');

        y += 16;
      });

      // --- Table Total Summary Row ---
      if (y > 500) {
        doc.addPage();
        y = 35;
      }

      doc.moveTo(25, y).lineTo(815, y).lineWidth(1).strokeColor('#9CA3AF').stroke();
      y += 4;
      doc.rect(25, y, 790, 18).fill('#F3F4F6');
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(8);
      doc.text('TOTALS', 32, y + 5);
      doc.text(String(config.totalKioskCount), 185, y + 5, { width: 45, align: 'right' });
      doc.text(config.totalGrossRevenue.toFixed(2), 235, y + 5, { width: 85, align: 'right' });
      doc.text(config.totalGstAmount.toFixed(2), 325, y + 5, { width: 75, align: 'right' });
      doc.text(config.totalPgFeeAmount.toFixed(2), 405, y + 5, { width: 75, align: 'right' });
      doc.text(config.totalNetworkShare.toFixed(2), 485, y + 5, { width: 100, align: 'right' });
      doc.text(config.totalCompanyShareBeforeRoyalty.toFixed(2), 590, y + 5, { width: 100, align: 'right' });
      doc.fillColor('#047857')
        .text(config.totalIpRoyaltyShare.toFixed(2), 695, y + 5, { width: 110, align: 'right' });

      // --- Confidentiality & Payout Notice ---
      y += 30;
      if (y > 520) {
        doc.addPage();
        y = 35;
      }
      doc.fontSize(7).font('Helvetica-Oblique').fillColor('#6B7280');
      doc.text(
        'CONFIDENTIAL: This statement is generated automatically by ArcadeLX from verified daily revenue snapshots. ' +
        'Network share represents combined distributor and partner allocations. Nilee Games share represents company revenue before royalty. ' +
        'Please raise an invoice matching "Your Share" to initiate settlement payout.',
        25,
        y,
        { width: 790, align: 'center' }
      );

      doc.end();

      const relativePath = path.join(periodFolder, filename);
      stream.on('finish', () => resolve(relativePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
};

