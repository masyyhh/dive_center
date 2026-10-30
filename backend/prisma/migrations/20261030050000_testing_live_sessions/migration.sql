CREATE TABLE "TestingLiveSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "liveUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "liveTokenCiphertext" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestingLiveSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TestingLiveSession_tokenHash_key" ON "TestingLiveSession"("tokenHash");
CREATE INDEX "TestingLiveSession_expiresAt_idx" ON "TestingLiveSession"("expiresAt");
ALTER TABLE "TestingLiveSession" ADD CONSTRAINT "TestingLiveSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
