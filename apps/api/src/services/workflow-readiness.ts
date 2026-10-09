import { prisma } from '../utils/db';
import { ApiError } from '../utils/ApiError';

export async function workflowReadiness() {
  // Request rejection was removed (it is not in the base Backend branch), so only the order
  // workflow columns are still probed.
  const [row] = await prisma.$queryRaw<{ orderDecisions: boolean }[]>`
    SELECT
      (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Kiosk' AND column_name='reservedOrderId')
        AND to_regclass('public."EmailDelivery"') IS NOT NULL
        AND to_regclass('public."OrderSequence"') IS NOT NULL) AS "orderDecisions"`;
  return row!;
}

export async function requireWorkflow(key: keyof Awaited<ReturnType<typeof workflowReadiness>>) {
  if (!(await workflowReadiness())[key]) throw new ApiError(503, 'This action is temporarily unavailable. Please contact your administrator.');
}
