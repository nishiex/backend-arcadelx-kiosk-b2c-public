CREATE TABLE "RemovedGateway" (
    "provider" VARCHAR(64) NOT NULL,
    "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemovedGateway_pkey" PRIMARY KEY ("provider")
);

-- Easebuzz was already disabled by the upstream fallback before durable local
-- deletion was added. Preserve that requested removal across future deployments.
INSERT INTO "RemovedGateway" ("provider")
VALUES ('easebuzz')
ON CONFLICT ("provider") DO NOTHING;
