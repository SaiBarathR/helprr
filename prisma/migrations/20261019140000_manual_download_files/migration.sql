-- CreateEnum
CREATE TYPE "ManualDownloadFileDecision" AS ENUM ('PENDING', 'IMPORT', 'IGNORE');

-- AlterTable
ALTER TABLE "ManualDownload" ADD COLUMN     "arrCommandId" INTEGER,
ADD COLUMN     "pathMapping" JSONB;

-- CreateTable
CREATE TABLE "ManualDownloadFile" (
    "id" TEXT NOT NULL,
    "downloadId" TEXT NOT NULL,
    "fileIndex" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "selected" BOOLEAN NOT NULL,
    "arrPath" TEXT,
    "candidate" JSONB,
    "decision" "ManualDownloadFileDecision" NOT NULL DEFAULT 'PENDING',
    "episodeIds" INTEGER[],

    CONSTRAINT "ManualDownloadFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManualDownloadFile_downloadId_fileIndex_key" ON "ManualDownloadFile"("downloadId", "fileIndex");

-- AddForeignKey
ALTER TABLE "ManualDownloadFile" ADD CONSTRAINT "ManualDownloadFile_downloadId_fkey" FOREIGN KEY ("downloadId") REFERENCES "ManualDownload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
