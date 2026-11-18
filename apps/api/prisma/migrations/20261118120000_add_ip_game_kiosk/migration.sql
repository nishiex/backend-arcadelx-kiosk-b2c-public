-- CreateTable: IpGameKiosk
-- Tracks which physical kiosks are licensed to run a given IP game.
-- Company OWNER/ADMIN manage this list; both Company and IP_PARTY can read it.

CREATE TABLE "IpGameKiosk" (
    "id"         TEXT NOT NULL,
    "ipGameId"   TEXT NOT NULL,
    "kioskId"    TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpGameKiosk_pkey" PRIMARY KEY ("id")
);

-- UniqueConstraint: one row per game-kiosk pair
CREATE UNIQUE INDEX "IpGameKiosk_ipGameId_kioskId_key" ON "IpGameKiosk"("ipGameId", "kioskId");

-- Index for lookups by game
CREATE INDEX "IpGameKiosk_ipGameId_idx" ON "IpGameKiosk"("ipGameId");

-- Index for lookups by kiosk
CREATE INDEX "IpGameKiosk_kioskId_idx" ON "IpGameKiosk"("kioskId");

-- AddForeignKey: IpGameKiosk.ipGameId -> IpGame.id (cascade delete)
ALTER TABLE "IpGameKiosk" ADD CONSTRAINT "IpGameKiosk_ipGameId_fkey"
    FOREIGN KEY ("ipGameId") REFERENCES "IpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: IpGameKiosk.kioskId -> Kiosk.id (cascade delete)
ALTER TABLE "IpGameKiosk" ADD CONSTRAINT "IpGameKiosk_kioskId_fkey"
    FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
