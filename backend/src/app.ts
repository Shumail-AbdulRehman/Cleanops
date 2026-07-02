import "./config/initializeRuntime.js";
import { accountAccess } from "./middlewares/accountAccess.middleware.js";
import "./cron/deletedMediaCron.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { Response, Request, NextFunction } from "express";
import { ApiError } from "./utils/ApiError.js";
import { getCookieRuntimeConfig } from "./utils/cookies.js";
import "./cron/dailyTaskScheduler.js";
import "./cron/onceTaskScheduler.js";
import "./cron/taskStatusCron.js";
import "./cron/taskReassignmentCron.js";
import "./cron/attendanceCron.js";
import "./cron/attendanceStatusCron.js";
import "./cron/staffNotificationCron.js";
import { runStartupCron } from "./cron/startupCron.js";
import { handlePaddleWebhook } from "./controllers/paddleWebhook.controller.js";




dotenv.config();
const app = express();
configureTrustProxy(app);
const parsedPort = Number.parseInt((process.env.PORT ?? "").trim(), 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 8080;
const allowedOrigins = (process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((origin) =>
        origin
            .trim()
            .replace(/^['"]+|['"]+$/g, "")
            .replace(/\/+$/, "")
    )
    .filter(Boolean);

const isPrivateDevelopmentOrigin = (origin: string) => {
    try {
        const url = new URL(origin);

        if (!["http:", "https:"].includes(url.protocol)) {
            return false;
        }

        const hostname = url.hostname;

        if (hostname === "localhost" || hostname === "127.0.0.1") {
            return true;
        }

        return (
            /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
        );
    } catch {
        return false;
    }
};

app.use(cors({
    origin: (origin, callback) => {
        const normalizedOrigin = origin?.replace(/\/+$/, "");
        const isDevelopment = process.env.NODE_ENV !== "production";

        if (
            !origin ||
            (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) ||
            (normalizedOrigin && isDevelopment && isPrivateDevelopmentOrigin(normalizedOrigin))
        ) {
            return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
}));
// This route must be mounted before express.json(). Paddle verifies the exact
// bytes it delivered, so parsing and re-serializing the body would invalidate
// the signature.
app.post(
    "/api/webhooks/paddle",
    express.raw({ type: "application/json", limit: "1mb" }),
    handlePaddleWebhook,
);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());

import managerRouter from "./routes/manager.route.js";
import staffRouter from "./routes/staff.route.js";
import staffNotificationRouter from "./routes/staffNotification.route.js";
import staffMobileRouter from "./routes/staffMobile.route.js";
import locationRouter from "./routes/location.route.js";
import taskTemplateRouter from "./routes/taskTemplate.route.js";
import assignmentRouter from "./routes/assignment.route.js";
import attendanceRouter from "./routes/attendance.route.js";
import taskInstanceRouter from "./routes/taskInstance.route.js"
import workforceLifecycleRouter from './routes/workforceLifecycle.route.js';
import {archiveRetainedEntity} from './services/verification-v2/retention.service.js';
import {verifyJwt} from './middlewares/auth.middleware.js';
import areaRouter, {areaLocationRouter} from './routes/area.route.js';
import verificationExceptionRouter from './routes/verificationException.route.js';
import verificationRouter from './routes/verification.route.js';
import evidenceRouter from './routes/evidence.route.js';
import launchRouter, { configureTrustProxy, createListenCallback, launchErrorHandler } from './routes/launch.route.js';





app.use('/api', launchRouter);

for (const [path, entity] of [['location','location'],['staff','staff'],['manager','manager'],['task-template','taskTemplate']] as const) {
 app.post(`/api/${path}/:id/archive`,verifyJwt,accountAccess("MANAGE_WORK"),async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)throw new ApiError(400,'Invalid identifier');
  res.json({success:true,data:await archiveRetainedEntity(entity,id,req.user!,req.body)});
 });
}
app.use("/api/workforce", workforceLifecycleRouter);
app.use("/api/manager", managerRouter);
app.use("/api/staff/mobile", staffMobileRouter);
app.use("/api/staff", staffRouter);
app.use("/api/staff-notifications", staffNotificationRouter);
app.use("/api/location", areaLocationRouter);
app.use("/api/area", areaRouter);
app.use("/api/location", locationRouter);
app.use("/api/task-template", taskTemplateRouter);
app.use("/api/assignment", assignmentRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api", verificationRouter);
app.use("/api", verificationExceptionRouter);
app.use("/api/task-instance",taskInstanceRouter)


app.use("/api/evidence", evidenceRouter);

app.use(launchErrorHandler);

app.listen(port, createListenCallback(async () => {
    console.log(`Server is listening at port ${port}`);
    console.log("Cookie config:", getCookieRuntimeConfig());
    await runStartupCron();
}));

export default app;
