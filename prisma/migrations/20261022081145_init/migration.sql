-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYS_ADMIN', 'EXEC', 'IR_LEAD', 'IR_STAFF', 'LEGAL', 'FINANCE', 'HR_ESOP', 'AUDITOR', 'INVESTOR', 'PROSPECT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MoneyAccess" AS ENUM ('ROLE_DEFAULT', 'NONE', 'FULL');

-- CreateEnum
CREATE TYPE "InvestorType" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "InvestorCategory" AS ENUM ('FOUNDER', 'VC', 'STRATEGIC', 'ANGEL', 'EMPLOYEE', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestorStage" AS ENUM ('LEAD', 'CONTACTED', 'NDA', 'DUE_DILIGENCE', 'TERM_SHEET', 'COMMITTED', 'SHAREHOLDER', 'PARTIAL_EXIT', 'EXITED', 'DROPPED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ShareClassKind" AS ENUM ('COMMON', 'PREFERRED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TxnKind" AS ENUM ('ISSUE', 'TRANSFER', 'REDEMPTION');

-- CreateEnum
CREATE TYPE "TxnStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConvertibleKind" AS ENUM ('SAFE_POST', 'SAFE_PRE', 'CONVERTIBLE_NOTE');

-- CreateEnum
CREATE TYPE "ConvertibleStatus" AS ENUM ('OUTSTANDING', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VestingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('ACTIVE', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Confidentiality" AS ENUM ('INTERNAL', 'CONFIDENTIAL', 'STRICT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "UserKind" NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "moneyAccess" "MoneyAccess" NOT NULL DEFAULT 'ROLE_DEFAULT',
    "larkOpenId" TEXT,
    "googleSub" TEXT,
    "investorId" TEXT,
    "accessExpires" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "ip" TEXT,
    "method" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ip" TEXT,
    "data" JSONB,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InvestorType" NOT NULL,
    "category" "InvestorCategory" NOT NULL,
    "stage" "InvestorStage" NOT NULL DEFAULT 'LEAD',
    "isForeign" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT NOT NULL DEFAULT 'VN',
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "taxCode" TEXT,
    "idNumberEnc" TEXT,
    "bankAccountEnc" TEXT,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "irOwnerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorContact" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestorContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageChange" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "from" "InvestorStage",
    "to" "InvestorStage" NOT NULL,
    "note" TEXT,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareClass" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ShareClassKind" NOT NULL,
    "votesPerShare" INTEGER NOT NULL DEFAULT 1,
    "parValue" DECIMAL(20,2) NOT NULL DEFAULT 10000,
    "liquidationPrefX" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "seniority" INTEGER NOT NULL DEFAULT 0,
    "participating" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingRound" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'PLANNED',
    "closeDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "preMoney" DECIMAL(24,2),
    "pricePerShare" DECIMAL(24,6),
    "targetAmount" DECIMAL(24,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareTransaction" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "kind" "TxnKind" NOT NULL,
    "status" "TxnStatus" NOT NULL DEFAULT 'DRAFT',
    "date" TIMESTAMP(3) NOT NULL,
    "shareClassId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "fromInvestorId" TEXT,
    "toInvestorId" TEXT,
    "roundId" TEXT,
    "pricePerShare" DECIMAL(24,6),
    "amount" DECIMAL(24,2),
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "fxRate" DECIMAL(18,6),
    "convertibleId" TEXT,
    "esopGrantId" TEXT,
    "reversesId" TEXT,
    "docRef" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "ShareTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConvertibleInstrument" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "kind" "ConvertibleKind" NOT NULL,
    "status" "ConvertibleStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "principal" DECIMAL(24,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "valuationCap" DECIMAL(24,2),
    "discountPct" DECIMAL(5,2),
    "interestPct" DECIMAL(5,2),
    "issueDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3),
    "docRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConvertibleInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsopPool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shareClassId" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsopPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsopGrant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "grantDate" TIMESTAMP(3) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "exercisePrice" DECIMAL(24,2) NOT NULL,
    "vestingStart" TIMESTAMP(3) NOT NULL,
    "cliffMonths" INTEGER NOT NULL DEFAULT 12,
    "vestingMonths" INTEGER NOT NULL DEFAULT 48,
    "frequency" "VestingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "status" "GrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminatedAt" TIMESTAMP(3),
    "docRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsopGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "confidentiality" "Confidentiality" NOT NULL DEFAULT 'CONFIDENTIAL',
    "investorId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_larkOpenId_key" ON "User"("larkOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_investorId_key" ON "User"("investorId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "OtpCode_email_createdAt_idx" ON "OtpCode"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_hash_key" ON "AuditLog"("hash");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Investor_code_key" ON "Investor"("code");

-- CreateIndex
CREATE INDEX "Interaction_investorId_date_idx" ON "Interaction"("investorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShareClass_code_key" ON "ShareClass"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRound_code_key" ON "FundingRound"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShareTransaction_seq_key" ON "ShareTransaction"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "ShareTransaction_convertibleId_key" ON "ShareTransaction"("convertibleId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareTransaction_reversesId_key" ON "ShareTransaction"("reversesId");

-- CreateIndex
CREATE INDEX "ShareTransaction_status_date_idx" ON "ShareTransaction"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ConvertibleInstrument_code_key" ON "ConvertibleInstrument"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EsopGrant_code_key" ON "EsopGrant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investor" ADD CONSTRAINT "Investor_irOwnerId_fkey" FOREIGN KEY ("irOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorContact" ADD CONSTRAINT "InvestorContact_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageChange" ADD CONSTRAINT "StageChange_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareTransaction" ADD CONSTRAINT "ShareTransaction_shareClassId_fkey" FOREIGN KEY ("shareClassId") REFERENCES "ShareClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareTransaction" ADD CONSTRAINT "ShareTransaction_fromInvestorId_fkey" FOREIGN KEY ("fromInvestorId") REFERENCES "Investor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareTransaction" ADD CONSTRAINT "ShareTransaction_toInvestorId_fkey" FOREIGN KEY ("toInvestorId") REFERENCES "Investor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareTransaction" ADD CONSTRAINT "ShareTransaction_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "FundingRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareTransaction" ADD CONSTRAINT "ShareTransaction_convertibleId_fkey" FOREIGN KEY ("convertibleId") REFERENCES "ConvertibleInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareTransaction" ADD CONSTRAINT "ShareTransaction_esopGrantId_fkey" FOREIGN KEY ("esopGrantId") REFERENCES "EsopGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareTransaction" ADD CONSTRAINT "ShareTransaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "ShareTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertibleInstrument" ADD CONSTRAINT "ConvertibleInstrument_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsopPool" ADD CONSTRAINT "EsopPool_shareClassId_fkey" FOREIGN KEY ("shareClassId") REFERENCES "ShareClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsopGrant" ADD CONSTRAINT "EsopGrant_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "EsopPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsopGrant" ADD CONSTRAINT "EsopGrant_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "Investor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
