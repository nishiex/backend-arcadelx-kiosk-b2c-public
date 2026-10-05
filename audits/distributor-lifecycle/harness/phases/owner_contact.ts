import assert from 'node:assert/strict';

// Real handlers and database, captured email; no online writes.
export async function run(c: any) {
  const { prisma, http, check, sql } = c;
  const company = c.company;
  const counts = () => Promise.all([prisma.user.count(), prisma.organization.count(), prisma.membership.count(), prisma.emailDelivery.count()]);
  const invite = await c.invite(company);
  const base = { ...c.registration('contact-validation'), inviteCode: invite };
  const before = await counts(), mailCount = c.mails.length;
  for (const value of [undefined, '', '12345', '12345678901', 'abcdefghij', '+919123456789', 9123456789]) {
    await http('contact-invalid-input-rejected', company, 'POST', '/api/auth/register', { ...base, ownerContact: value }, 400);
  }
  assert.deepEqual(await counts(), before);
  assert.equal(c.mails.length, mailCount);
  assert.equal((await prisma.organization.findUnique({ where: { id: company.orgId }, select: { inviteCode: true } })).inviteCode, invite);
  check('invalid owner contact creates no records/email and preserves invitation', true);

  const input = { ...base, ownerContact: ' 0123456789 ', phone: '9999999999', gstNumber: 'TEST-CONTACT-GST' };
  const created = await http('contact-distributor-register', company, 'POST', '/api/auth/register', input, 201);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: created.data.data.owner.id }, select: { id: true, contact: true } });
  assert.equal(owner.contact, '0123456789');
  assert.equal(created.data.data.owner.contact, '0123456789');
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: created.data.data.organization.id } });
  assert.equal(org.phone, input.phone); assert.equal(org.gstNumber, input.gstNumber);
  check('contact preserves leading zero and stays separate from GST/organization phone', true);
  const password = c.mails.findLast((mail: any) => mail.To[0].Email === input.ownerEmail).TextPart.match(/Temporary Password:\s*([^\s]+)/)[1];
  const distributor = await c.login('contact-distributor', input.ownerEmail, password);
  const identity = await http('contact-owner-login-and-dashboard', distributor, 'GET', '/api/auth/me', undefined, 200);
  assert.ok(!('contact' in identity.data.data.user), 'Contact does not leak into unrelated identity responses');

  const duplicateInvite = await c.invite(company);
  const duplicateBefore = await counts(), duplicateMails = c.mails.length;
  const duplicate = await http('contact-duplicate-owner-rejected', company, 'POST', '/api/auth/register', {
    ...c.registration('contact-duplicate'), ownerContact: owner.contact, inviteCode: duplicateInvite,
  }, 409);
  assert.match(duplicate.data.message, /contact number already exists/);
  assert.deepEqual(await counts(), duplicateBefore); assert.equal(c.mails.length, duplicateMails);
  assert.equal((await prisma.organization.findUnique({ where: { id: company.orgId }, select: { inviteCode: true } })).inviteCode, duplicateInvite);
  check('duplicate contact preserves users, email queue and unconsumed invite', true);

  // Two different organization registrations must not share an owner contact.
  const raceBefore = await counts(), raceMails = c.mails.length;
  const race = await Promise.all([0, 1].map(index => http('contact-concurrent-registration', distributor, 'POST', '/api/auth/register', {
    ...c.registration('contact-race-' + index, 'PARTNER'), ownerContact: '8123456789',
  })));
  assert.deepEqual(race.map(result => result.status).sort(), [201, 409]);
  assert.deepEqual(await counts(), raceBefore.map((n: number) => n + 1));
  assert.equal(c.mails.length, raceMails + 1);
  check('concurrent contact uniqueness commits one owner/org/membership/email', true);
  await assert.rejects(prisma.user.create({ data: { name: 'Bad direct contact', email: 'bad-contact@example.invalid', passwordHash: 'unused', contact: 'letters' } }));
  check('database enforces contact format outside HTTP validation', true);

  // Simulate the pre-migration schema temporarily, in this isolated local DB.
  await sql.query('ALTER TABLE "User" RENAME COLUMN contact TO legacy_contact');
  try {
    const legacy = await c.login('contact-legacy-owner', 'company@example.invalid');
    await http('contact-legacy-schema-identity', legacy, 'GET', '/api/auth/me', undefined, 200);
    const generated = await http('contact-legacy-schema-member-invite', legacy, 'POST', '/api/members/generateInviteCode', { role: 'STAFF' }, 201);
    await http('contact-legacy-schema-staff-join', null, 'POST', '/api/auth/join', {
      name: 'Contact legacy staff', email: 'contact-legacy-staff@example.invalid', password: c.password, inviteCode: generated.data.data.inviteCode,
    }, 201);
    await http('contact-legacy-schema-registration-explains-migration', legacy, 'POST', '/api/auth/register', c.registration('contact-pending-migration', 'PARTNER'), 503);
  } finally {
    await sql.query('ALTER TABLE "User" RENAME COLUMN legacy_contact TO contact');
  }
  const staff = await prisma.user.findUniqueOrThrow({ where: { email: 'contact-legacy-staff@example.invalid' }, select: { contact: true } });
  assert.equal(staff.contact, null);
  check('legacy login and staff join remain compatible before contact migration', true);
}
