-- CreateEnum
CREATE TYPE "PasswordLinkPurpose" AS ENUM ('invite', 'reset');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityAuditAction" ADD VALUE 'INVITE_CREATED';
ALTER TYPE "SecurityAuditAction" ADD VALUE 'INVITE_REGENERATED';
ALTER TYPE "SecurityAuditAction" ADD VALUE 'INVITE_REVOKED';
ALTER TYPE "SecurityAuditAction" ADD VALUE 'INVITE_ACCEPTED';
ALTER TYPE "SecurityAuditAction" ADD VALUE 'RESET_LINK_CREATED';
ALTER TYPE "SecurityAuditAction" ADD VALUE 'RESET_LINK_REVOKED';
ALTER TYPE "SecurityAuditAction" ADD VALUE 'RESET_LINK_USED';

-- CreateTable
CREATE TABLE "PasswordLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "PasswordLinkPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordLink_userId_key" ON "PasswordLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordLink_tokenHash_key" ON "PasswordLink"("tokenHash");

-- AddForeignKey
ALTER TABLE "PasswordLink" ADD CONSTRAINT "PasswordLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
