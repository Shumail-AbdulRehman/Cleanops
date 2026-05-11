-- CreateIndex
CREATE INDEX "TaskInstance_staffId_isActive_date_idx" ON "TaskInstance"("staffId", "isActive", "date");

-- CreateIndex
CREATE INDEX "TaskInstance_staffId_status_idx" ON "TaskInstance"("staffId", "status");

-- CreateIndex
CREATE INDEX "TaskTemplate_staffId_isActive_idx" ON "TaskTemplate"("staffId", "isActive");
