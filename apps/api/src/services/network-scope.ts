/**
 * Network scope: which organizations count as one organization's fleet.
 *
 * The hierarchy is written in three places and they do not always agree.
 * `Organization.parentOrgId` is set when an org registers against an invite or is created by
 * its parent; a `NetworkConnection` is written when two orgs connect; an `Agreement` is
 * written when they start trading. Seeded, migrated and older rows can carry one without the
 * others, so every read path that answers "is this machine part of my network?" unions all
 * three here. Keeping that resolution in one place is what stops the kiosk inventory, the Ads
 * picker and the Devices screen from drifting apart -- the Ads picker used to read only
 * `parentOrgId`, so a Partner linked by connection or agreement never reached the list.
 *
 * Traversal is deliberately shallow: one level of children, plus one level under a Company's
 * Distributors (Company -> Distributors -> Partners). Nothing walks deeper, so a Partner's
 * own children can never be pulled in by accident.
 */
import { prisma } from '../utils/db';

type LinkedOrg = { id: string; type: string };

/** Every organization directly linked under any of `parentIds`. */
async function linkedChildren(parentIds: string[]): Promise<LinkedOrg[]> {
  const [byParent, connections, agreements] = await Promise.all([
    prisma.organization.findMany({
      where: { parentOrgId: { in: parentIds } },
      select: { id: true, type: true },
    }),
    prisma.networkConnection.findMany({
      where: { status: 'ACTIVE', initiatorOrgId: { in: parentIds } },
      select: { reciever: { select: { id: true, type: true } } },
    }),
    prisma.agreement.findMany({
      where: { status: 'ACTIVE', parentOrgId: { in: parentIds } },
      select: { childOrg: { select: { id: true, type: true } } },
    }),
  ]);

  // One org can arrive through all three sources; the map keeps a single entry per id.
  const links = new Map<string, string>();
  for (const org of byParent) links.set(org.id, org.type);
  for (const connection of connections) links.set(connection.reciever.id, connection.reciever.type);
  for (const agreement of agreements) links.set(agreement.childOrg.id, agreement.childOrg.type);

  return [...links].map(([id, type]) => ({ id, type }));
}

/**
 * The caller's own organization plus every organization whose kiosks it may see:
 * a Company sees its Distributors and their Partners, a Distributor sees its Partners, and a
 * Partner sees only itself.
 */
export async function networkOrgIds(organizationId: string, orgType: string): Promise<string[]> {
  const allowed = new Set<string>([organizationId]);
  if (orgType === 'PARTNER') return [...allowed];

  const children = await linkedChildren([organizationId]);
  for (const child of children) allowed.add(child.id);

  // Only a Company reaches through a Distributor to that Distributor's Partners.
  const distributorIds = children
    .filter((child) => child.type === 'DISTRIBUTOR')
    .map((child) => child.id);
  if (orgType === 'COMPANY' && distributorIds.length > 0) {
    for (const partner of await linkedChildren(distributorIds)) allowed.add(partner.id);
  }

  return [...allowed];
}
