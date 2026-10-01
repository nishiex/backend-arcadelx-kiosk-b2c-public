--
-- PostgreSQL database dump
--

\restrict xs40KSuoB78uoWUhlTwHvaCDapOw9HSWMwv5WfjnHSxqdUMebAiWPj0uiahQIYO

-- Dumped from database version 16.15 (Debian 16.15-1.pgdg13+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AgreementStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgreementStatus" AS ENUM (
    'DRAFT',
    'PENDING_APPROVAL',
    'ACTIVE',
    'TERMINATED'
);


--
-- Name: KioskStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."KioskStatus" AS ENUM (
    'AVAILABLE',
    'RESERVED',
    'ASSIGNED',
    'INSTALLED',
    'MAINTENANCE',
    'RETURNED',
    'RETIRED'
);


--
-- Name: MembershipStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MembershipStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'REJECTED'
);


--
-- Name: NetworkStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NetworkStatus" AS ENUM (
    'PENDING',
    'ACTIVE'
);


--
-- Name: OrgType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrgType" AS ENUM (
    'COMPANY',
    'DISTRIBUTOR',
    'PARTNER'
);


--
-- Name: PermissionAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PermissionAction" AS ENUM (
    'CREATE',
    'EDIT',
    'DELETE',
    'VIEW',
    'VIEW_ALL',
    'EXPORT'
);


--
-- Name: PermissionModule; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PermissionModule" AS ENUM (
    'STAFF',
    'ROLES',
    'DISTRIBUTORS',
    'PARTNERS',
    'KIOSKS',
    'ORDERS',
    'REVENUE',
    'REPORTS',
    'SETTLEMENTS',
    'PAYMENTS',
    'AGREEMENTS',
    'NETWORK',
    'SUPPORT',
    'AUDIT_LOGS',
    'SETTINGS'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'OWNER',
    'ADMIN',
    'MANAGER',
    'STAFF'
);


--
-- Name: SettlementStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SettlementStatus" AS ENUM (
    'PENDING',
    'PAID'
);


--
-- Name: SupportPriority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SupportPriority" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
);


--
-- Name: SupportStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SupportStatus" AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'RESOLVED',
    'CLOSED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Agreement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Agreement" (
    id text NOT NULL,
    "networkConnectionId" text NOT NULL,
    "parentOrgId" text NOT NULL,
    "childOrgId" text NOT NULL,
    "parentSharePct" numeric(5,2) NOT NULL,
    "childSharePct" numeric(5,2) NOT NULL,
    "effectiveFrom" timestamp(3) without time zone NOT NULL,
    "effectiveTo" timestamp(3) without time zone,
    status public."AgreementStatus" DEFAULT 'DRAFT'::public."AgreementStatus" NOT NULL,
    "pdfUrl" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "depositAmountPerMachine" integer NOT NULL,
    "nonRefundableAmountPerMachine" integer NOT NULL,
    CONSTRAINT "depositAmountPerMachine_positive" CHECK (("depositAmountPerMachine" >= 0)),
    CONSTRAINT "nonRefundableAmountPerMachine_positive" CHECK (("nonRefundableAmountPerMachine" >= 0))
);


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditLog" (
    id text NOT NULL,
    "actorUserId" text,
    "actorName" text DEFAULT 'Unknown'::text NOT NULL,
    "actorOrgType" text,
    "actorOrgName" text,
    action text NOT NULL,
    entity text NOT NULL,
    reference text,
    method text NOT NULL,
    path text NOT NULL,
    "statusCode" integer NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    detail text
);


--
-- Name: Kiosk; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Kiosk" (
    id text NOT NULL,
    "machineCode" text NOT NULL,
    model text NOT NULL,
    status public."KioskStatus" DEFAULT 'AVAILABLE'::public."KioskStatus" NOT NULL,
    "externalDeviceId" text,
    "currentOrgId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    location text,
    "serialNumber" text,
    "hardwareFingerprint" text,
    "firmwareVersion" text,
    "manufactureDate" timestamp(3) without time zone,
    "warrantyExpiry" timestamp(3) without time zone
);


--
-- Name: KioskAssignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KioskAssignment" (
    id text NOT NULL,
    "kioskId" text NOT NULL,
    "organizationId" text NOT NULL,
    "orderId" text,
    "assignedById" text NOT NULL,
    "assignedFrom" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "assignedTo" timestamp(3) without time zone
);


--
-- Name: KioskRevenue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KioskRevenue" (
    id text NOT NULL,
    "kioskId" text NOT NULL,
    "organizationId" text,
    year integer NOT NULL,
    month integer NOT NULL,
    "grossRevenue" numeric(12,2) NOT NULL,
    "companySharePct" numeric(5,2) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: MachineSequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MachineSequence" (
    year integer NOT NULL,
    value integer DEFAULT 0 NOT NULL
);


--
-- Name: Membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Membership" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "organizationId" text NOT NULL,
    role public."Role",
    status public."MembershipStatus" DEFAULT 'PENDING'::public."MembershipStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "permissionRoleId" text
);


--
-- Name: NetworkConnection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NetworkConnection" (
    id text NOT NULL,
    "initiatorOrgId" text NOT NULL,
    "receiverOrgId" text NOT NULL,
    status public."NetworkStatus" DEFAULT 'PENDING'::public."NetworkStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Organization" (
    id text NOT NULL,
    "ownerId" text NOT NULL,
    name text NOT NULL,
    type public."OrgType" NOT NULL,
    state text NOT NULL,
    city text NOT NULL,
    pincode integer NOT NULL,
    address text NOT NULL,
    "inviteCode" text,
    "inviteCodeExpiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "gstNumber" text,
    phone text,
    country text DEFAULT 'India'::text
);


--
-- Name: PasswordReset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PasswordReset" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "otpHash" text NOT NULL,
    "resetToken" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "verifiedAt" timestamp(3) without time zone,
    "usedAt" timestamp(3) without time zone,
    attempts integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    reference text NOT NULL,
    "settlementId" text NOT NULL,
    "organizationId" text NOT NULL,
    amount numeric(12,2) NOT NULL,
    method text DEFAULT 'Bank Transfer'::text NOT NULL,
    "transactionRef" text,
    "paidAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PermissionRole; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PermissionRole" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    description text,
    "isSystem" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: RefreshToken; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefreshToken" (
    id text NOT NULL,
    token text NOT NULL,
    "userId" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: RolePermission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RolePermission" (
    id text NOT NULL,
    "permissionRoleId" text NOT NULL,
    module public."PermissionModule" NOT NULL,
    action public."PermissionAction" NOT NULL
);


--
-- Name: Settlement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Settlement" (
    id text NOT NULL,
    reference text NOT NULL,
    "organizationId" text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    "grossRevenue" numeric(12,2) NOT NULL,
    "companyShare" numeric(12,2) NOT NULL,
    "distributorShare" numeric(12,2) NOT NULL,
    status public."SettlementStatus" DEFAULT 'PENDING'::public."SettlementStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SupportTicket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportTicket" (
    id text NOT NULL,
    subject text NOT NULL,
    description text NOT NULL,
    category text,
    status public."SupportStatus" DEFAULT 'OPEN'::public."SupportStatus" NOT NULL,
    priority public."SupportPriority" DEFAULT 'MEDIUM'::public."SupportPriority" NOT NULL,
    "organizationId" text NOT NULL,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "aadharNumber" text,
    "panNumber" text,
    mobile text,
    "alternateMobile" text,
    "dateOfBirth" timestamp(3) without time zone,
    "emergencyContact" text,
    address text
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: kiosk_machine_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kiosk_machine_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Agreement Agreement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agreement"
    ADD CONSTRAINT "Agreement_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: KioskAssignment KioskAssignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KioskAssignment"
    ADD CONSTRAINT "KioskAssignment_pkey" PRIMARY KEY (id);


--
-- Name: KioskRevenue KioskRevenue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KioskRevenue"
    ADD CONSTRAINT "KioskRevenue_pkey" PRIMARY KEY (id);


--
-- Name: Kiosk Kiosk_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Kiosk"
    ADD CONSTRAINT "Kiosk_pkey" PRIMARY KEY (id);


--
-- Name: MachineSequence MachineSequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MachineSequence"
    ADD CONSTRAINT "MachineSequence_pkey" PRIMARY KEY (year);


--
-- Name: Membership Membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_pkey" PRIMARY KEY (id);


--
-- Name: NetworkConnection NetworkConnection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NetworkConnection"
    ADD CONSTRAINT "NetworkConnection_pkey" PRIMARY KEY (id);


--
-- Name: Organization Organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);


--
-- Name: PasswordReset PasswordReset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PasswordReset"
    ADD CONSTRAINT "PasswordReset_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: PermissionRole PermissionRole_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PermissionRole"
    ADD CONSTRAINT "PermissionRole_pkey" PRIMARY KEY (id);


--
-- Name: RefreshToken RefreshToken_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefreshToken"
    ADD CONSTRAINT "RefreshToken_pkey" PRIMARY KEY (id);


--
-- Name: RolePermission RolePermission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_pkey" PRIMARY KEY (id);


--
-- Name: Settlement Settlement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Settlement"
    ADD CONSTRAINT "Settlement_pkey" PRIMARY KEY (id);


--
-- Name: SupportTicket SupportTicket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicket"
    ADD CONSTRAINT "SupportTicket_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: AuditLog_actorUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_actorUserId_idx" ON public."AuditLog" USING btree ("actorUserId");


--
-- Name: AuditLog_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_createdAt_idx" ON public."AuditLog" USING btree ("createdAt");


--
-- Name: KioskAssignment_kioskId_assignedTo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KioskAssignment_kioskId_assignedTo_idx" ON public."KioskAssignment" USING btree ("kioskId", "assignedTo");


--
-- Name: KioskAssignment_organizationId_assignedTo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KioskAssignment_organizationId_assignedTo_idx" ON public."KioskAssignment" USING btree ("organizationId", "assignedTo");


--
-- Name: KioskRevenue_kioskId_year_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "KioskRevenue_kioskId_year_month_key" ON public."KioskRevenue" USING btree ("kioskId", year, month);


--
-- Name: KioskRevenue_organizationId_year_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KioskRevenue_organizationId_year_month_idx" ON public."KioskRevenue" USING btree ("organizationId", year, month);


--
-- Name: Kiosk_externalDeviceId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Kiosk_externalDeviceId_key" ON public."Kiosk" USING btree ("externalDeviceId");


--
-- Name: Kiosk_machineCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Kiosk_machineCode_key" ON public."Kiosk" USING btree ("machineCode");


--
-- Name: Kiosk_serialNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Kiosk_serialNumber_key" ON public."Kiosk" USING btree ("serialNumber");


--
-- Name: Membership_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Membership_organizationId_idx" ON public."Membership" USING btree ("organizationId");


--
-- Name: Membership_permissionRoleId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Membership_permissionRoleId_idx" ON public."Membership" USING btree ("permissionRoleId");


--
-- Name: Membership_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Membership_userId_key" ON public."Membership" USING btree ("userId");


--
-- Name: Organization_inviteCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Organization_inviteCode_key" ON public."Organization" USING btree ("inviteCode");


--
-- Name: PasswordReset_resetToken_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PasswordReset_resetToken_key" ON public."PasswordReset" USING btree ("resetToken");


--
-- Name: PasswordReset_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PasswordReset_userId_idx" ON public."PasswordReset" USING btree ("userId");


--
-- Name: Payment_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payment_organizationId_idx" ON public."Payment" USING btree ("organizationId");


--
-- Name: Payment_reference_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Payment_reference_key" ON public."Payment" USING btree (reference);


--
-- Name: Payment_settlementId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payment_settlementId_idx" ON public."Payment" USING btree ("settlementId");


--
-- Name: PermissionRole_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PermissionRole_organizationId_idx" ON public."PermissionRole" USING btree ("organizationId");


--
-- Name: PermissionRole_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PermissionRole_organizationId_name_key" ON public."PermissionRole" USING btree ("organizationId", name);


--
-- Name: RefreshToken_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefreshToken_token_key" ON public."RefreshToken" USING btree (token);


--
-- Name: RolePermission_permissionRoleId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RolePermission_permissionRoleId_idx" ON public."RolePermission" USING btree ("permissionRoleId");


--
-- Name: RolePermission_permissionRoleId_module_action_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RolePermission_permissionRoleId_module_action_key" ON public."RolePermission" USING btree ("permissionRoleId", module, action);


--
-- Name: Settlement_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Settlement_organizationId_idx" ON public."Settlement" USING btree ("organizationId");


--
-- Name: Settlement_organizationId_year_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Settlement_organizationId_year_month_key" ON public."Settlement" USING btree ("organizationId", year, month);


--
-- Name: Settlement_reference_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Settlement_reference_key" ON public."Settlement" USING btree (reference);


--
-- Name: SupportTicket_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportTicket_organizationId_status_idx" ON public."SupportTicket" USING btree ("organizationId", status);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: only_one_company; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX only_one_company ON public."Organization" USING btree (type) WHERE (type = 'COMPANY'::public."OrgType");


--
-- Name: Agreement Agreement_childOrgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agreement"
    ADD CONSTRAINT "Agreement_childOrgId_fkey" FOREIGN KEY ("childOrgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Agreement Agreement_networkConnectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agreement"
    ADD CONSTRAINT "Agreement_networkConnectionId_fkey" FOREIGN KEY ("networkConnectionId") REFERENCES public."NetworkConnection"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Agreement Agreement_parentOrgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agreement"
    ADD CONSTRAINT "Agreement_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KioskAssignment KioskAssignment_assignedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KioskAssignment"
    ADD CONSTRAINT "KioskAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KioskAssignment KioskAssignment_kioskId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KioskAssignment"
    ADD CONSTRAINT "KioskAssignment_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES public."Kiosk"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KioskAssignment KioskAssignment_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KioskAssignment"
    ADD CONSTRAINT "KioskAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KioskRevenue KioskRevenue_kioskId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KioskRevenue"
    ADD CONSTRAINT "KioskRevenue_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES public."Kiosk"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KioskRevenue KioskRevenue_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KioskRevenue"
    ADD CONSTRAINT "KioskRevenue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Kiosk Kiosk_currentOrgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Kiosk"
    ADD CONSTRAINT "Kiosk_currentOrgId_fkey" FOREIGN KEY ("currentOrgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Membership Membership_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Membership Membership_permissionRoleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_permissionRoleId_fkey" FOREIGN KEY ("permissionRoleId") REFERENCES public."PermissionRole"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Membership Membership_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: NetworkConnection NetworkConnection_initiatorOrgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NetworkConnection"
    ADD CONSTRAINT "NetworkConnection_initiatorOrgId_fkey" FOREIGN KEY ("initiatorOrgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: NetworkConnection NetworkConnection_receiverOrgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NetworkConnection"
    ADD CONSTRAINT "NetworkConnection_receiverOrgId_fkey" FOREIGN KEY ("receiverOrgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Organization Organization_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PasswordReset PasswordReset_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PasswordReset"
    ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Payment Payment_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Payment Payment_settlementId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES public."Settlement"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PermissionRole PermissionRole_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PermissionRole"
    ADD CONSTRAINT "PermissionRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefreshToken RefreshToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefreshToken"
    ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RolePermission RolePermission_permissionRoleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_permissionRoleId_fkey" FOREIGN KEY ("permissionRoleId") REFERENCES public."PermissionRole"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Settlement Settlement_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Settlement"
    ADD CONSTRAINT "Settlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SupportTicket SupportTicket_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicket"
    ADD CONSTRAINT "SupportTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SupportTicket SupportTicket_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportTicket"
    ADD CONSTRAINT "SupportTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict xs40KSuoB78uoWUhlTwHvaCDapOw9HSWMwv5WfjnHSxqdUMebAiWPj0uiahQIYO

