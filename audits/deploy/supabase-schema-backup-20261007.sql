-- Supabase public schema dump
-- Generated 2026-10-07T12:50:51.143Z before the Vercel deployment schema rebuild.
-- Restore with: psql <this file>  (after DROP SCHEMA public CASCADE; CREATE SCHEMA public;)
-- NOTE: data is NOT included; the source database held 0 rows in all application tables.

-- ===================== ENUM TYPES =====================
CREATE TYPE "public"."AgreementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'TERMINATED', 'REJECTED');
CREATE TYPE "public"."KioskStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ASSIGNED', 'INSTALLED', 'MAINTENANCE', 'RETURNED', 'RETIRED');
CREATE TYPE "public"."MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');
CREATE TYPE "public"."NetworkStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');
CREATE TYPE "public"."OrderStatus" AS ENUM ('UNDER_REVIEW', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'REJECTED');
CREATE TYPE "public"."OrderType" AS ENUM ('REQUEST', 'ALLOCATION');
CREATE TYPE "public"."OrgType" AS ENUM ('COMPANY', 'DISTRIBUTOR', 'PARTNER');
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE "public"."Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'STAFF');
CREATE TYPE "public"."StatementStatus" AS ENUM ('GENERATED', 'PAID');
CREATE TYPE "public"."SyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- ===================== TABLES =====================
DROP TABLE IF EXISTS "public"."Agreement" CASCADE;
CREATE TABLE "public"."Agreement" (
  "id" text NOT NULL,
  "networkConnectionId" text NOT NULL,
  "parentOrgId" text NOT NULL,
  "childOrgId" text NOT NULL,
  "parentSharePct" numeric(5,2) NOT NULL,
  "childSharePct" numeric(5,2) NOT NULL,
  "effectiveFrom" timestamp(3) without time zone NOT NULL,
  "effectiveTo" timestamp(3) without time zone,
  "status" "AgreementStatus" DEFAULT 'DRAFT'::"AgreementStatus" NOT NULL,
  "pdfUrl" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "depositAmountPerMachine" integer NOT NULL,
  "nonRefundableAmountPerMachine" integer NOT NULL,
);
DROP TABLE IF EXISTS "public"."Kiosk" CASCADE;
CREATE TABLE "public"."Kiosk" (
  "id" text NOT NULL,
  "machineCode" text NOT NULL,
  "model" text NOT NULL,
  "status" "KioskStatus" DEFAULT 'AVAILABLE'::"KioskStatus" NOT NULL,
  "externalDeviceId" text,
  "currentOrgId" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "location" text,
);
DROP TABLE IF EXISTS "public"."KioskAssignment" CASCADE;
CREATE TABLE "public"."KioskAssignment" (
  "id" text NOT NULL,
  "kioskId" text NOT NULL,
  "organizationId" text NOT NULL,
  "orderId" text,
  "assignedById" text NOT NULL,
  "assignedFrom" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "assignedTo" timestamp(3) without time zone,
);
DROP TABLE IF EXISTS "public"."MachineSequence" CASCADE;
CREATE TABLE "public"."MachineSequence" (
  "year" integer NOT NULL,
  "value" integer DEFAULT 0 NOT NULL,
);
DROP TABLE IF EXISTS "public"."Membership" CASCADE;
CREATE TABLE "public"."Membership" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "organizationId" text NOT NULL,
  "role" "Role",
  "status" "MembershipStatus" DEFAULT 'PENDING'::"MembershipStatus" NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
);
DROP TABLE IF EXISTS "public"."NetworkConnection" CASCADE;
CREATE TABLE "public"."NetworkConnection" (
  "id" text NOT NULL,
  "initiatorOrgId" text NOT NULL,
  "receiverOrgId" text NOT NULL,
  "status" "NetworkStatus" DEFAULT 'PENDING'::"NetworkStatus" NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "deletedAt" timestamp(3) without time zone,
);
DROP TABLE IF EXISTS "public"."Order" CASCADE;
CREATE TABLE "public"."Order" (
  "id" text NOT NULL,
  "orderNumber" text NOT NULL,
  "type" "OrderType" NOT NULL,
  "status" "OrderStatus" DEFAULT 'UNDER_REVIEW'::"OrderStatus" NOT NULL,
  "parentOrgId" text NOT NULL,
  "childOrgId" text NOT NULL,
  "agreementId" text NOT NULL,
  "quantity" integer NOT NULL,
  "depositPerMachine" double precision NOT NULL,
  "nonRefundablePerMachine" double precision NOT NULL,
  "totalDeposit" double precision NOT NULL,
  "totalNonRefundable" double precision NOT NULL,
  "taxAmount" double precision NOT NULL,
  "grandTotal" double precision NOT NULL,
  "invoiceUrl" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "paymentStatus" "PaymentStatus" DEFAULT 'PENDING'::"PaymentStatus" NOT NULL,
  "invoiceFilename" text,
);
DROP TABLE IF EXISTS "public"."OrderKiosk" CASCADE;
CREATE TABLE "public"."OrderKiosk" (
  "orderId" text NOT NULL,
  "kioskId" text NOT NULL,
);
DROP TABLE IF EXISTS "public"."Organization" CASCADE;
CREATE TABLE "public"."Organization" (
  "id" text NOT NULL,
  "ownerId" text NOT NULL,
  "name" text NOT NULL,
  "type" "OrgType" NOT NULL,
  "state" text NOT NULL,
  "city" text NOT NULL,
  "pincode" integer NOT NULL,
  "address" text NOT NULL,
  "inviteCode" text,
  "inviteCodeExpiresAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "gstNumber" text,
);
DROP TABLE IF EXISTS "public"."PasswordReset" CASCADE;
CREATE TABLE "public"."PasswordReset" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "otpHash" text NOT NULL,
  "resetToken" text,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "verifiedAt" timestamp(3) without time zone,
  "usedAt" timestamp(3) without time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
);
DROP TABLE IF EXISTS "public"."RefreshToken" CASCADE;
CREATE TABLE "public"."RefreshToken" (
  "id" text NOT NULL,
  "token" text NOT NULL,
  "userId" text NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "revoked" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
);
DROP TABLE IF EXISTS "public"."RevenueStatement" CASCADE;
CREATE TABLE "public"."RevenueStatement" (
  "id" text NOT NULL,
  "organizationId" text NOT NULL,
  "Month" integer NOT NULL,
  "Year" integer NOT NULL,
  "GrossRevenue" numeric(12,2) NOT NULL,
  "netRevenue" numeric(12,2) NOT NULL,
  "companyShare" numeric(12,2) NOT NULL,
  "distributorShare" numeric(12,2) NOT NULL,
  "partnerShare" numeric(12,2) NOT NULL,
  "pdfPath" text NOT NULL,
  "status" "StatementStatus" DEFAULT 'GENERATED'::"StatementStatus" NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "finalPayout" numeric(12,2) NOT NULL,
  "tdsAmount" numeric(12,2) NOT NULL,
);
DROP TABLE IF EXISTS "public"."RevenueSyncRunLog" CASCADE;
CREATE TABLE "public"."RevenueSyncRunLog" (
  "id" text NOT NULL,
  "runAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "totalRecordsFetched" integer DEFAULT 0 NOT NULL,
  "newRecordsInserted" integer DEFAULT 0 NOT NULL,
  "unattributedCount" integer DEFAULT 0 NOT NULL,
  "status" "SyncStatus" NOT NULL,
  "errorMessage" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
);
DROP TABLE IF EXISTS "public"."SystemSettings" CASCADE;
CREATE TABLE "public"."SystemSettings" (
  "id" text DEFAULT 'default'::text NOT NULL,
  "gstPercentage" numeric(5,2) DEFAULT 18.00 NOT NULL,
  "pgFeePercentage" numeric(5,2) DEFAULT 2.50 NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "tdsPercentage" numeric(5,2) DEFAULT 2.00 NOT NULL,
);
DROP TABLE IF EXISTS "public"."Transaction" CASCADE;
CREATE TABLE "public"."Transaction" (
  "id" text NOT NULL,
  "kioskId" text NOT NULL,
  "gameId" text NOT NULL,
  "amount" numeric(10,2) NOT NULL,
  "currency" text DEFAULT 'INR'::text NOT NULL,
  "externalTransactionId" text NOT NULL,
  "occurredAt" timestamp(3) without time zone NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
);
DROP TABLE IF EXISTS "public"."User" CASCADE;
CREATE TABLE "public"."User" (
  "id" text NOT NULL,
  "email" text NOT NULL,
  "passwordHash" text NOT NULL,
  "name" text NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "contact" text NOT NULL,
);

-- ===================== CONSTRAINTS =====================
ALTER TABLE "public".""Agreement"" ADD CONSTRAINT "Agreement_childOrgId_fkey" FOREIGN KEY ("childOrgId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Agreement"" ADD CONSTRAINT "Agreement_networkConnectionId_fkey" FOREIGN KEY ("networkConnectionId") REFERENCES "NetworkConnection"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Agreement"" ADD CONSTRAINT "Agreement_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Agreement"" ADD CONSTRAINT "Agreement_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""Agreement"" ADD CONSTRAINT "depositAmountPerMachine_positive" CHECK (("depositAmountPerMachine" >= 0));
ALTER TABLE "public".""Agreement"" ADD CONSTRAINT "nonRefundableAmountPerMachine_positive" CHECK (("nonRefundableAmountPerMachine" >= 0));
ALTER TABLE "public".""Kiosk"" ADD CONSTRAINT "Kiosk_currentOrgId_fkey" FOREIGN KEY ("currentOrgId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "public".""Kiosk"" ADD CONSTRAINT "Kiosk_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""KioskAssignment"" ADD CONSTRAINT "KioskAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""KioskAssignment"" ADD CONSTRAINT "KioskAssignment_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""KioskAssignment"" ADD CONSTRAINT "KioskAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "public".""KioskAssignment"" ADD CONSTRAINT "KioskAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""KioskAssignment"" ADD CONSTRAINT "KioskAssignment_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""MachineSequence"" ADD CONSTRAINT "MachineSequence_pkey" PRIMARY KEY (year);
ALTER TABLE "public".""Membership"" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Membership"" ADD CONSTRAINT "Membership_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""Membership"" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""NetworkConnection"" ADD CONSTRAINT "NetworkConnection_initiatorOrgId_fkey" FOREIGN KEY ("initiatorOrgId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""NetworkConnection"" ADD CONSTRAINT "NetworkConnection_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""NetworkConnection"" ADD CONSTRAINT "NetworkConnection_receiverOrgId_fkey" FOREIGN KEY ("receiverOrgId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Order"" ADD CONSTRAINT "Order_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Order"" ADD CONSTRAINT "Order_childOrgId_fkey" FOREIGN KEY ("childOrgId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Order"" ADD CONSTRAINT "Order_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Order"" ADD CONSTRAINT "Order_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""OrderKiosk"" ADD CONSTRAINT "OrderKiosk_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""OrderKiosk"" ADD CONSTRAINT "OrderKiosk_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""OrderKiosk"" ADD CONSTRAINT "OrderKiosk_pkey" PRIMARY KEY ("orderId", "kioskId");
ALTER TABLE "public".""Organization"" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Organization"" ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""PasswordReset"" ADD CONSTRAINT "PasswordReset_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""PasswordReset"" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "public".""RefreshToken"" ADD CONSTRAINT "RefreshToken_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""RefreshToken"" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""RevenueStatement"" ADD CONSTRAINT "RevenueStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""RevenueStatement"" ADD CONSTRAINT "RevenueStatement_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""RevenueSyncRunLog"" ADD CONSTRAINT "RevenueSyncRunLog_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""SystemSettings"" ADD CONSTRAINT "SystemSettings_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""Transaction"" ADD CONSTRAINT "Transaction_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "public".""Transaction"" ADD CONSTRAINT "Transaction_pkey" PRIMARY KEY (id);
ALTER TABLE "public".""User"" ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);

-- ===================== INDEXES =====================
CREATE UNIQUE INDEX "Kiosk_externalDeviceId_key" ON public."Kiosk" USING btree ("externalDeviceId");
CREATE UNIQUE INDEX "Kiosk_machineCode_key" ON public."Kiosk" USING btree ("machineCode");
CREATE INDEX "KioskAssignment_kioskId_assignedTo_idx" ON public."KioskAssignment" USING btree ("kioskId", "assignedTo");
CREATE INDEX "KioskAssignment_organizationId_assignedTo_idx" ON public."KioskAssignment" USING btree ("organizationId", "assignedTo");
CREATE INDEX "Membership_organizationId_idx" ON public."Membership" USING btree ("organizationId");
CREATE UNIQUE INDEX "Membership_userId_key" ON public."Membership" USING btree ("userId");
CREATE UNIQUE INDEX "Order_orderNumber_key" ON public."Order" USING btree ("orderNumber");
CREATE UNIQUE INDEX "Organization_inviteCode_key" ON public."Organization" USING btree ("inviteCode");
CREATE UNIQUE INDEX only_one_company ON public."Organization" USING btree (type) WHERE (type = 'COMPANY'::"OrgType");
CREATE UNIQUE INDEX "PasswordReset_resetToken_key" ON public."PasswordReset" USING btree ("resetToken");
CREATE INDEX "PasswordReset_userId_idx" ON public."PasswordReset" USING btree ("userId");
CREATE UNIQUE INDEX "RefreshToken_token_key" ON public."RefreshToken" USING btree (token);
CREATE UNIQUE INDEX "RevenueStatement_organizationId_Month_Year_key" ON public."RevenueStatement" USING btree ("organizationId", "Month", "Year");
CREATE UNIQUE INDEX "Transaction_externalTransactionId_key" ON public."Transaction" USING btree ("externalTransactionId");
CREATE INDEX "Transaction_kioskId_occurredAt_idx" ON public."Transaction" USING btree ("kioskId", "occurredAt");
CREATE UNIQUE INDEX "User_contact_key" ON public."User" USING btree (contact);
CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);
