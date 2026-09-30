import { prisma } from '../utils/db';
import { ApiError } from '../utils/ApiError';

export async function workflowReadiness() {
  const [row] = await prisma.$queryRaw<{ networkRejection: boolean; agreementRejection: boolean; orderDecisions: boolean }[]>`
    SELECT
      EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='NetworkStatus' AND e.enumlabel='REJECTED') AS "networkRejection",
      EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='AgreementStatus' AND e.enumlabel='REJECTED') AS "agreementRejection",
      (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Kiosk' AND column_name='reservedOrderId')
        AND to_regclass('public."EmailDelivery"') IS NOT NULL
        AND to_regclass('public."OrderSequence"') IS NOT NULL) AS "orderDecisions"`;
  return row!;
}

export async function requireWorkflow(key: keyof Awaited<ReturnType<typeof workflowReadiness>>) {
  if (!(await workflowReadiness())[key]) throw new ApiError(503, 'This action is temporarily unavailable. Please contact your administrator.');
}
