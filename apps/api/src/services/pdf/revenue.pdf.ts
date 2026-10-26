import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';

// /tmp is the only writable location on Vercel.
export const REVENUE_REPORTS_DIR = process.env.REVENUE_REPORTS_DIR
  || (process.env.VERCEL ? '/tmp/reports' : path.join(process.cwd(), 'uploads', 'reports'));
if (process.env.NODE_ENV === 'production' && process.env.REVENUE_JOBS_ENABLED === 'true' && (!process.env.REVENUE_REPORTS_DIR || !path.isAbsolute(REVENUE_REPORTS_DIR))) {
  throw new Error('Production revenue jobs require an absolute REVENUE_REPORTS_DIR');
}

export interface RevenueRow {
  machineCode: string;
  gross: number;
  gst: number;
  pgFee: number;
  net: number;
  companyShare: number;
  distributorShare: number;
  partnerShare: number;
  tds:number,
  finalPayout:number
}

export interface ReportConfig {
  orgName: string;
  orgType: 'COMPANY' | 'DISTRIBUTOR' | 'PARTNER';
  parentOrgType?: 'COMPANY' | 'DISTRIBUTOR';
  month: number;
  year: number;
  gstRate: number;
  pgRate: number;
  tdsRate: number;
  rows: RevenueRow[];
}

export const generateRevenueStatement = (config: ReportConfig): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Scalable Folder Structure: /uploads/reports/YYYY-MM/
    const periodFolder = `${config.year}-${String(config.month).padStart(2, '0')}`;
    const REPORTS_DIR = path.join(REVENUE_REPORTS_DIR, periodFolder);
    
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const filename = `REV-${config.orgName.replace(/[^a-z0-9]/gi, '_').slice(0, 80)}-${crypto.randomUUID()}.pdf`;
    const filePath = path.join(REPORTS_DIR, filename);

    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.on('error', reject);

    // --- Header ---
    doc.fontSize(18).text(`Monthly Revenue Statement: ${config.orgName}`, { align: 'center' }).moveDown();
    doc.fontSize(12).text(`Period: ${config.month}/${config.year}`);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`).moveDown(2);

    // --- Table Headers ---
    const startY = doc.y;
    let colX = 30;
    
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('MachineCode', colX, startY); colX += 95;
    doc.text('Gross Rev', colX, startY); colX += 75;
    doc.text(`PG Fee (${config.pgRate}%)`, colX, startY); colX += 75;
    doc.text('Net Rev', colX, startY); colX += 75;

    // Visibility Routing for the specific client
    if (config.orgType === 'DISTRIBUTOR') {
    doc.text('Company Share', colX, startY); colX += 85;
    doc.text('Distributor Share', colX, startY); colX += 85;
    doc.text(`TDS (${config.tdsRate}%)`, colX, startY); colX += 70;
    doc.text('Final Payout', colX, startY);
 } else if (config.orgType === 'PARTNER') {
  const parentShareLabel = config.parentOrgType === 'DISTRIBUTOR'? 'Distributor Share': 'Company Share';

  doc.text(parentShareLabel, colX, startY); colX += 95;
  doc.text('Partner Share', colX, startY); colX += 85;
  doc.text(`TDS (${config.tdsRate}%)`, colX, startY); colX += 70;
  doc.text('Final Payout', colX, startY);
}


    doc.moveTo(30, startY + 15).lineTo(colX + 80, startY + 15).stroke();
    
    // --- Table Rows ---
    let currentY = startY + 25;
    doc.font('Helvetica');

    config.rows.forEach(row => {
      if (currentY > 500) {
        doc.addPage();
        currentY = 50; 
      }

      colX = 30;
      doc.text(row.machineCode, colX, currentY); colX += 95;
      doc.text(`Rs. ${row.gross.toFixed(2)}`, colX, currentY); colX += 75;
      doc.text(`Rs. ${row.pgFee.toFixed(2)}`, colX, currentY); colX += 75;
      doc.text(`Rs. ${row.net.toFixed(2)}`, colX, currentY); colX += 75;

      if (config.orgType === 'DISTRIBUTOR') {
      doc.text(`Rs. ${row.companyShare.toFixed(2)}`, colX, currentY); colX += 85;
      doc.text(`Rs. ${row.distributorShare.toFixed(2)}`, colX, currentY); colX += 85;
      doc.text(`Rs. ${row.tds.toFixed(2)}`, colX, currentY); colX += 70;
      doc.text(`Rs. ${row.finalPayout.toFixed(2)}`, colX, currentY);
    } else if (config.orgType === 'PARTNER') {
  const parentShare =config.parentOrgType === 'DISTRIBUTOR'? row.distributorShare: row.companyShare;

  doc.text(`Rs. ${parentShare.toFixed(2)}`, colX, currentY);
  colX += 95;
  doc.text(`Rs. ${row.partnerShare.toFixed(2)}`, colX, currentY);
  colX += 85;
  doc.text(`Rs. ${row.tds.toFixed(2)}`, colX, currentY);
  colX += 70;
  doc.text(`Rs. ${row.finalPayout.toFixed(2)}`, colX, currentY);
}

      
      currentY += 20;
    });

    doc.end();
    // Return relative path to easily save to DB if needed later
    stream.on('finish', () => resolve(path.join(periodFolder, filename))); 
    stream.on('error', reject);
  });
};
