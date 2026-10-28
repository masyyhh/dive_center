CREATE TABLE "RevokedToken" (
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");
