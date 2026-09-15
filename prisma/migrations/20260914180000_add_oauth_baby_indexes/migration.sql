-- CreateIndex
CREATE INDEX "OAuthAuditLog_babyId_createdAt_idx" ON "OAuthAuditLog"("babyId", "createdAt");

-- CreateIndex
CREATE INDEX "OAuthConsent_babyId_idx" ON "OAuthConsent"("babyId");
