-- Old installs keep their existing channels until a new app registers the event channels.
ALTER TABLE "StaffPushDevice" ADD COLUMN "alertChannelVersion" INTEGER NOT NULL DEFAULT 1;
