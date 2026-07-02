CREATE TABLE "StaffNotification" (
 "id" SERIAL PRIMARY KEY, "staffId" INTEGER NOT NULL REFERENCES "Staff"(id) ON DELETE CASCADE,
 "companyId" INTEGER NOT NULL, "kind" TEXT NOT NULL CHECK ("kind" IN ('TASK_ASSIGNED','TASK_CHANGED','SHIFT_APPROACHING','MISSING_CHECK_IN','CHECKOUT_APPROACHING')),
 "eventKey" TEXT NOT NULL UNIQUE, "taskId" INTEGER, "attendanceId" INTEGER,
 "data" JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 "expiresAt" TIMESTAMP(3) NOT NULL, "readAt" TIMESTAMP(3)
);
CREATE INDEX "StaffNotification_staffId_companyId_id_idx" ON "StaffNotification"("staffId","companyId",id);
CREATE INDEX "StaffNotification_staffId_readAt_idx" ON "StaffNotification"("staffId","readAt");
CREATE INDEX "StaffNotification_expiresAt_idx" ON "StaffNotification"("expiresAt");
CREATE TABLE "StaffPushDevice" (
 "id" TEXT PRIMARY KEY, "staffId" INTEGER NOT NULL REFERENCES "Staff"(id) ON DELETE CASCADE,
 "companyId" INTEGER NOT NULL, "token" TEXT NOT NULL UNIQUE, "platform" TEXT NOT NULL CHECK (platform IN ('android','ios')),
 "language" TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ur')), "sessionHash" TEXT NOT NULL,
 "sessionExpiresAt" TIMESTAMP(3) NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "boundAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StaffPushDevice_staffId_enabled_idx" ON "StaffPushDevice"("staffId",enabled);
CREATE TABLE "StaffPushDelivery" (
 "id" SERIAL PRIMARY KEY, "notificationId" INTEGER NOT NULL REFERENCES "StaffNotification"(id) ON DELETE CASCADE,
 "deviceId" TEXT NOT NULL REFERENCES "StaffPushDevice"(id) ON DELETE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','ACCEPTED','FAILED','CANCELLED')),
 "attempts" INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 "lockedUntil" TIMESTAMP(3), "ticketId" TEXT, "sentToken" TEXT, "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 UNIQUE("notificationId","deviceId")
);
CREATE INDEX "StaffPushDelivery_status_availableAt_idx" ON "StaffPushDelivery"(status,"availableAt");

-- Catch every creation/reassignment/cancellation path, including schedulers and
-- bulk operations, without sending a network request inside business writes.
CREATE FUNCTION staff_task_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_staff INTEGER; target_staff INTEGER; tenant INTEGER; task_id INTEGER;
 task_location INTEGER; task_title TEXT; task_end TIMESTAMP; reason TEXT; active_task BOOLEAN; task_status TEXT;
BEGIN
 IF TG_OP = 'DELETE' THEN
  previous_staff := OLD."staffId"; task_id := OLD.id; task_location := OLD."locationId"; task_title := OLD.title;
  task_end := OLD."shiftEnd"; reason := 'cancelled'; active_task := OLD."isActive"; task_status := OLD.status::text;
 ELSE
  task_id := NEW.id; task_location := NEW."locationId"; task_title := NEW.title; task_end := NEW."shiftEnd";
  active_task := NEW."isActive"; task_status := NEW.status::text;
  IF TG_OP = 'UPDATE' THEN
   IF (OLD."isActive" AND NOT NEW."isActive") OR (OLD.status <> 'CANCELLED' AND NEW.status = 'CANCELLED') THEN
    previous_staff := OLD."staffId"; reason := 'cancelled';
   ELSIF OLD."staffId" IS DISTINCT FROM NEW."staffId" THEN
    previous_staff := OLD."staffId"; target_staff := NEW."staffId"; reason := 'reassigned';
   ELSE RETURN NEW;
   END IF;
  ELSE target_staff := NEW."staffId";
  END IF;
 END IF;
 IF task_end <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN RETURN COALESCE(NEW,OLD); END IF;
 IF previous_staff IS NOT NULL AND (TG_OP <> 'DELETE' OR (active_task AND task_status IN ('PENDING','IN_PROGRESS','NOT_COMPLETED_INTIME'))) THEN
  SELECT "companyId" INTO tenant FROM "Staff" WHERE id=previous_staff AND "isActive" AND "companyId"=(SELECT "companyId" FROM "Location" WHERE id=task_location);
  IF tenant IS NOT NULL THEN
   INSERT INTO "StaffNotification"("staffId","companyId",kind,"eventKey","taskId",data,"expiresAt")
   VALUES(previous_staff,tenant,'TASK_CHANGED','task:'||task_id||':'||txid_current()||':changed:'||previous_staff,task_id,
    jsonb_build_object('change',reason,'taskTitle',task_title),task_end) ON CONFLICT ("eventKey") DO NOTHING;
  END IF;
 END IF;
 IF target_staff IS NOT NULL AND active_task AND task_status IN ('PENDING','IN_PROGRESS') THEN
  SELECT "companyId" INTO tenant FROM "Staff" WHERE id=target_staff AND "isActive" AND "companyId"=(SELECT "companyId" FROM "Location" WHERE id=task_location);
  IF tenant IS NOT NULL THEN
   INSERT INTO "StaffNotification"("staffId","companyId",kind,"eventKey","taskId",data,"expiresAt")
   VALUES(target_staff,tenant,'TASK_ASSIGNED','task:'||task_id||':'||txid_current()||':assigned:'||target_staff,task_id,
    jsonb_build_object('taskTitle',task_title),task_end) ON CONFLICT ("eventKey") DO NOTHING;
  END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER staff_task_notification AFTER INSERT OR UPDATE OF "staffId",status,"isActive" OR DELETE ON "TaskInstance"
 FOR EACH ROW EXECUTE FUNCTION staff_task_notification();
