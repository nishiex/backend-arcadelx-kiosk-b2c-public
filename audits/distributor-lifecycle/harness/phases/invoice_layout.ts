import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';

// Run after happy; all archive changes are limited to that phase's local fixture.
export async function run(c: any) {
  const order = await c.prisma.order.findUniqueOrThrow({ where: { id: c.upOrder.id } });
  const archivePath = path.join(c.outDir, 'invoices', order.invoiceFilename);
  const archive = await fs.readFile(archivePath);
  const legacy = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text('Legacy invoice fixture');
    doc.end();
  });
  const emailsBefore = c.mails.length;
  const route = `/api/orders/${order.id}/invoice`;
  try {
    await fs.writeFile(archivePath, legacy);
    const downloads = await Promise.all([c.company, c.distributor].map((actor, index) =>
      c.http(`invoice-layout-download-${index}`, actor, 'GET', route, undefined, 200),
    ));
    for (const response of downloads) {
      assert.equal(response.status, 200);
      assert.equal(response.pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(!response.pdf.equals(legacy), 'downloads must use the current layout');
      assert.match(response.pdf.toString('latin1'), /Order invoice/);
      assert.equal(response.cacheControl, 'private, no-store');
      assert.ok(response.pdf.length < 500000, 'invoice should stay compact');
    }
    await fs.writeFile(path.join(c.outDir, 'refreshed-invoice.pdf'), downloads[0].pdf);
    for (const [actor, status, label] of [[null, 401, 'anonymous'], [c.unrelated, 403, 'other-org']] as const) {
      const denied = await c.http(`invoice-layout-denied-${label}`, actor, 'GET', route, undefined, status);
      assert.equal(denied.status, status);
      assert.equal(denied.pdf, undefined);
    }
    assert.deepEqual(await fs.readFile(archivePath), legacy);
    assert.deepEqual(await c.prisma.order.findUniqueOrThrow({ where: { id: order.id } }), order);
    assert.equal(c.mails.length, emailsBefore);
    c.check('invoice-layout-keeps-archive-financial-snapshot-and-access', true);
  } finally {
    await fs.writeFile(archivePath, archive);
  }
}
