-- CreateIndex
CREATE INDEX "users_createdAt_id_idx" ON "users"("createdAt", "id");

-- CreateIndex
CREATE INDEX "users_livenessStatus_idx" ON "users"("livenessStatus");
