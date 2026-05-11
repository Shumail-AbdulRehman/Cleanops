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
import "./cron/attendanceCron.js";
import "./cron/attendanceStatusCron.js";
import { runStartupCron } from "./cron/startupCron.js";




dotenv.config();
const app = express();
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
}));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());

import managerRouter from "./routes/manager.route.js";
import staffRouter from "./routes/staff.route.js";
import locationRouter from "./routes/location.route.js";
import taskTemplateRouter from "./routes/taskTemplate.route.js";
import assignmentRouter from "./routes/assignment.route.js";
import attendanceRouter from "./routes/attendance.route.js";
import taskInstanceRouter from "./routes/taskInstance.route.js"
import commonRouter from "./routes/common.route.js"





app.use("/api/manager", managerRouter);
app.use("/api/staff", staffRouter);
app.use("/api/location", locationRouter);
app.use("/api/task-template", taskTemplateRouter);
app.use("/api/assignment", assignmentRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/task-instance",taskInstanceRouter)
app.use("/api/common",commonRouter)

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            errors: err.errors,
        });
    }
    console.error(err);
    res.status(500).json({ message: "Something went wrong" });
});

app.listen(port, async () => {
    console.log(`Server is listening at port ${port}`);
    console.log("Cookie config:", getCookieRuntimeConfig());
    await runStartupCron();
});

export default app;
