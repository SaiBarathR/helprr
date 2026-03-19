CREATE TABLE "AniListSeriesMapping" (
    "id" TEXT NOT NULL,
    "sonarrSeriesId" INTEGER NOT NULL,
    "anilistMediaId" INTEGER,
    "state" TEXT NOT NULL,
    "matchMethod" TEXT,
    "confidence" INTEGER,
    "seriesTitleSnapshot" TEXT NOT NULL,
    "seriesYearSnapshot" INTEGER,
    "seriesTvdbIdSnapshot" INTEGER,
    "seriesTmdbIdSnapshot" INTEGER,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AniListSeriesMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AniListSeriesMapping_sonarrSeriesId_key" ON "AniListSeriesMapping"("sonarrSeriesId");
