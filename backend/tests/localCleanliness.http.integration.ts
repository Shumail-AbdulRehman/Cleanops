import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { Transform } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { UploadApiOptions, UploadApiResponse, UploadResponseCallback } from "cloudinary";
import type { ErrorRequestHandler } from "express";
import pg from "pg";

const host = "127.0.0.1";
const adminSource = "postgresql://fixture@127.0.0.1:56442/priv_e2e_test";
const databasePrefix = "priv_local_model_e2e_";
const nativeFetch = globalThis.fetch;
const fixtureRoot = new URL("./fixtures/local-cleanliness/", import.meta.url);
const views = {
  SINK: { key: "basin_tap", visibilityCount: 3 },
  FLOOR: { key: "wide_zone", visibilityCount: 1 },
  MIRROR: { key: "reflective_surface", visibilityCount: 1 },
};

type Band = "CLEAN" | "DIRTY" | "REVIEW";
type Photo = { file: string; fixtureType: keyof typeof views; band: Band; pDirty: number };
type ScreeningAnswers = {
  cleanliness?: Record<string, { choice: string }>;
  cleanlinessModel?: {
    status: string;
    pDirty: number | null;
    band: Band | null;
    modelVersion: string | null;
    latencyMs: number;
    reason: string | null;
    fixtureType: string;
  };
};
type Assessment = { metadata: { provider: string; screeningAnswers: ScreeningAnswers } };

async function withDatabase(run: () => Promise<void>) {
  assert.ok(process.env.LOCAL_MODEL_E2E_DATABASE_URL === adminSource, "Isolated loopback test database URL required");
  const database = databasePrefix + Date.now();
  const admin = new pg.Client({ connectionString: adminSource, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    try {
      const url = new URL(adminSource);
      url.pathname = "/" + database;
      process.env.DATABASE_URL = url.href;
      process.env.DIRECT_URL = url.href;
      const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
      try {
        await client.connect();
        const migrations = new URL("../prisma/migrations/", import.meta.url);
        for (const name of (await readdir(migrations)).filter((name) => /^\d/.test(name)).sort()) {
          await client.query(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
        }
      } finally {
        await client.end();
      }
      await run();
    } finally {
      await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      const remaining = await admin.query("SELECT datname FROM pg_database WHERE starts_with(datname, $1)", [databasePrefix]);
      assert.equal(remaining.rowCount, 0, "Disposable database remains");
      console.log("Cleanup PASS: no priv_local_model_e2e_* database remains");
    }
  } finally {
    await admin.end();
  }
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function portOf(server: Server) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function startModel() {
  const listener = createServer().listen(0, host);
  await once(listener, "listening");
  const port = portOf(listener);
  await close(listener);

  const script = fileURLToPath(new URL("../../cleanliness-service/server.py", import.meta.url));
  const child = spawn("/home/shumail/cleandirty-env/bin/python", ["-B", script], {
    env: { ...process.env, CLEANLINESS_SERVICE_PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let exited = false;
  let spawnError: Error | undefined;
  child.once("error", (error) => { spawnError = error; });
  const stopped = new Promise<void>((resolve) => child.once("close", () => { exited = true; resolve(); }));
  const origin = `http://${host}:${port}`;

  return {
    origin,
    async ready() {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (exited) throw new Error("Cleanliness service exited before readiness");
        const response = await nativeFetch(origin + "/health", {
          redirect: "error",
          signal: AbortSignal.timeout(1000),
        }).catch(() => null);
        if (response) {
          const body = await response.json() as { status: string; modelVersion: string; device: string };
          if (response.ok) {
            assert.equal(body.status, "ok");
            assert.equal(body.device, "cpu");
            assert.match(body.modelVersion, /^cleandirty-4cat-dinov2-[a-f0-9]{12}$/);
            return body.modelVersion;
          }
          assert.notEqual(body.status, "error", "Cleanliness service failed to load weights");
        }
        await delay(500);
      }
      throw new Error("Cleanliness service readiness timed out");
    },
    async stop() {
      if (!exited) child.kill("SIGTERM");
      await stopped;
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host, port });
        socket.once("connect", () => {
          socket.destroy();
          reject(new Error(`Cleanliness service port ${port} still accepts connections`));
        });
        socket.once("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ECONNREFUSED") resolve();
          else reject(error);
        });
      });
    },
  };
}

function fakeCloudflare(url: URL, options?: RequestInit) {
  assert.equal(options?.method, "POST");
  assert.equal(typeof options?.body, "string");
  const request = JSON.parse(options!.body as string) as {
    model: string;
    questions: Record<string, { criteria: Record<string, string> }>;
  };
  const keys = Object.keys(request.questions);
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    const choice = key === "originality" ? "DIRECT"
      : key === "object_match" ? "MATCH"
      : key.startsWith("visible_") ? "VISIBLE" : "CLEAN";
    const options = Object.keys(question.criteria);
    assert.ok(options.includes(choice), `Unexpected CLEF question: ${key}`);
    return [key, {
      type: "choice",
      choice,
      confidence: 1,
      probabilities: Object.fromEntries(options.map((option) => [option, Number(option === choice)])),
    }];
  }));
  assert.equal(url.pathname.endsWith("/" + request.model), true);
  return { keys, response: Response.json({ success: true, result: { model: request.model, answers } }) };
}

async function runIntegration() {
  const signer = () => randomBytes(32).toString("hex");
  const fakeAccount = "0".repeat(32);
  const fixturePriceId = "pri_" + "0".repeat(26);
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  process.env.NODE_ENV = "test";
  process.env.AI_PROVIDER = "clef";
  process.env.CLEF_MODEL = "clef";
  process.env.CLOUDFLARE_ACCOUNT_ID = fakeAccount;
  process.env.CLOUDFLARE_API_TOKEN = randomUUID();
  process.env.PHOTO_CHECKS_OWNER_OVERRIDE = "true";
  process.env.CLEANLINESS_PROVIDER = "local-model";
  process.env.LOCAL_CLEANLINESS_TIMEOUT_MS = "15000";
  process.env.LOCAL_CLEANLINESS_MODEL_ID = "cleandirty-4cat-dinov2-20261117";
  process.env.ACCESS_TOKEN_SECRET = signer();
  process.env.ACCESS_TOKEN_EXPIRY = "30m";
  process.env.VERIFICATION_QR_SECRET = signer();
  process.env.VERIFICATION_SLOT_SECRET = signer();
  process.env.PADDLE_ENVIRONMENT = "sandbox";
  process.env.PADDLE_PRICE_CATALOG_JSON = JSON.stringify([{ plan: "STARTER", interval: "month", priceId: fixturePriceId }]);

  const { prisma } = await import("../src/prisma/prisma.js");
  try {
    const { default: express } = await import("express");
    const { default: cloudinary } = await import("../src/utils/cloudinary.js");
    const { generateAccessToken } = await import("../src/utils/auth.js");
    const { default: taskRouter } = await import("../src/routes/taskInstance.route.js");
    const { default: verificationRouter } = await import("../src/routes/verification.route.js");
    const { createTaskInstanceWithSnapshot } = await import("../src/services/verification-v2/inventorySnapshot.service.js");

    const assets = new Map<string, { asset_id: string; context: { custom: unknown } }>();
    cloudinary.api.resource = async (id: string) => {
      const asset = assets.get(id);
      if (!asset) throw { http_code: 404 };
      return asset;
    };
    cloudinary.uploader.upload_stream = (options?: UploadApiOptions | UploadResponseCallback, callback?: UploadResponseCallback) => {
      assert.ok(typeof options === "object" && options.public_id && callback);
      const publicId = options.public_id;
      return new Transform({
        transform(_chunk, _encoding, done) { done(); },
        flush(done) {
          const asset = { asset_id: randomUUID(), context: { custom: options.context } };
          assets.set(publicId, asset);
          callback(undefined, asset as unknown as UploadApiResponse);
          done();
        },
      });
    };
    cloudinary.uploader.destroy = async (id: string) => ({ result: assets.delete(id) ? "ok" : "not found" });

    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => { request.cookies = {}; next(); });
    app.use("/api/task-instance", taskRouter);
    app.use("/api", verificationRouter);
    const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
      response.status(error.statusCode ?? 500).json({ message: error.message, errors: error.errors });
    };
    app.use(handleError);

    const server = app.listen(0, host);
    try {
      await once(server, "listening");
      const apiOrigin = `http://${host}:${portOf(server)}`;
      const model = await startModel();
      try {
        process.env.LOCAL_CLEANLINESS_URL = model.origin;
        const modelVersion = await model.ready();
        const fixtureList = JSON.parse(await readFile(new URL("scores.json", fixtureRoot), "utf8")) as {
          modelVersion: string;
          photos: Photo[];
        };
        assert.equal(fixtureList.modelVersion, modelVersion, "Fixture scores must come from the expected model");
        const [clean, dirty, middle, mirror] = fixtureList.photos;
        assert.equal(clean.band, "CLEAN");
        assert.equal(dirty.band, "DIRTY");
        assert.equal(middle.band, "REVIEW");
        assert.equal(mirror.fixtureType, "MIRROR");

        const clefUrl = `https://api.cloudflare.com/client/v4/accounts/${fakeAccount}/ai/run/@cf/cloudflare/clef`;
        const clefRequests: string[][] = [];
        let modelRequests = 0;
        globalThis.fetch = async (input, options) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.href === clefUrl) {
            const { keys, response } = fakeCloudflare(url, options);
            clefRequests.push(keys);
            return response;
          }
          if (url.href === model.origin + "/score") modelRequests++;
          else assert.equal(url.origin === apiOrigin, true, "Unexpected outbound fetch blocked");
          return nativeFetch(input, { ...options, redirect: "error" });
        };

        const deviceId = "local-model-http-device";
        const bootId = "local-model-http-boot";
        const latitude = 24.8607;
        const longitude = 67.0011;

        function headers(actor: Parameters<typeof generateAccessToken>[0], role: "ADMIN" | "STAFF") {
          const token = generateAccessToken(actor, role);
          return { Authorization: `Bearer ${token}`, "X-Hygene-Workflow": "2", "X-Hygene-App-Version": "2.0.0" };
        }

        async function request<T>(path: string, auth: ReturnType<typeof headers>, expected: number, body?: object) {
          const httpBody = body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body);
          const response = await fetch(apiOrigin + "/api" + path, {
            method: body === undefined ? "GET" : "POST",
            headers: { ...auth, ...(typeof httpBody === "string" ? { "Content-Type": "application/json" } : {}) },
            body: httpBody,
            signal: AbortSignal.timeout(60_000),
          });
          const result = await response.json() as { data: T };
          assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
          return result.data;
        }

        type Slot = { id: string; requirementId: string | null; nonce: string };
        type Session = { id: string; serverTimeAnchor: string; slots: Slot[] };
        type Upload = { attemptId: string; state: string; reasonCode: string; storage: string };

        async function upload(label: string, photo: Photo) {
          // Evidence deduplication is tenant-wide. Isolate each flow so the same
          // clean fixture can run with the service down and in legacy CLEF mode.
          const now = new Date();
          const shiftStart = new Date(+now - 120_000);
          const shiftEnd = new Date(+now + 3_600_000);
          const view = views[photo.fixtureType];
          const customerId = "ctm_" + randomUUID();
          const subscriptionId = "sub_" + randomUUID();
          const company = await prisma.company.create({ data: {
            name: label, plan: "STARTER", subscriptionStatus: "ACTIVE",
            billingCustomerId: customerId, billingSubscriptionId: subscriptionId,
          } });
          // Work authorization reads the locally mirrored billing period.
          await prisma.paddleCustomer.create({ data: {
            id: customerId, companyId: company.id, status: "active", paddleUpdatedAt: now, lastEventAt: now,
          } });
          await prisma.paddleSubscription.create({ data: {
            id: subscriptionId, customerId, companyId: company.id, status: "active", priceId: fixturePriceId,
            productId: "pro_local_cleanliness_fixture", currentBillingPeriodStart: shiftStart, currentBillingPeriodEnd: shiftEnd,
            paddleUpdatedAt: now, lastEventAt: now,
          } });
          const location = await prisma.location.create({ data: {
            companyId: company.id, name: label, address: "Isolated test database",
            latitude: String(latitude), longitude: String(longitude), timezone: "Asia/Karachi",
          } });
          const area = await prisma.area.create({ data: { locationId: location.id, name: label, roomType: "WASHROOM", status: "ACTIVE" } });
          await prisma.areaItem.create({ data: {
            areaId: area.id, stableCode: `${photo.fixtureType}-TEST`, displayName: photo.fixtureType,
            fixtureType: photo.fixtureType, sequence: 1, rubricKey: "visible-v1",
            requiredViews: [{ key: view.key, instructions: `Show the ${photo.fixtureType}.`, mandatory: true }],
          } });
          const staff = await prisma.staff.create({ data: {
            companyId: company.id, locationId: location.id, name: "Photo test staff",
            email: randomUUID() + "@test.invalid", password: randomUUID(),
          } });
          const manager = await prisma.manager.create({ data: {
            companyId: company.id, name: "Photo test owner", role: "ADMIN",
            email: randomUUID() + "@test.invalid", password: randomUUID(),
          } });
          await prisma.attendance.create({ data: {
            staffId: staff.id, locationId: location.id, date: now, expectedStart: shiftStart,
            expectedEnd: shiftEnd, checkInTime: now, status: "CHECKED_IN",
          } });
          const template = await prisma.taskTemplate.create({ data: {
            locationId: location.id, areaId: area.id, staffId: staff.id, title: label, verificationVersion: 2,
            inventorySelection: "ALL", setupStatus: "READY", shiftStart, shiftEnd, effectiveDate: now,
          } });
          const task = await createTaskInstanceWithSnapshot({
            templateId: template.id, title: label, locationId: location.id, date: now, shiftStart, shiftEnd,
          });
          assert.ok(task);
          const taskPath = `/task-instance/${task.id}`;
          const managerAuth = headers(manager, "ADMIN");
          const staffAuth = headers(staff, "STAFF");
          const qr = await request<{ taskId: number; payload: string }>(taskPath + "/qr", managerAuth, 200);
          assert.equal(qr.taskId, task.id);
          await request(taskPath + "/start", staffAuth, 200, { areaQr: qr.payload });
          const session = await request<Session>(taskPath + "/capture-sessions", staffAuth, 201, {
            requestId: randomUUID(), areaQr: qr.payload, deviceId, clientBootId: bootId,
            clientTime: new Date().toISOString(), location: { latitude, longitude, accuracy: 3, sampledAt: new Date().toISOString() },
          });
          const sessionPath = `/capture-session/${session.id}`;
          const requirementSlot = session.slots.find((slot) => slot.requirementId);
          assert.ok(requirementSlot?.requirementId, "Fixture capture slot required");
          const activated = await request<Session>(sessionPath + "/activate-photo", staffAuth, 200, {
            deviceId, slotId: requirementSlot.id,
          });
          const slot = activated.slots.find((slot) => slot.id === requirementSlot.id);
          assert.ok(slot?.nonce);
          const image = await readFile(new URL(photo.file, fixtureRoot));
          const capturedAt = Date.now();
          const form = new FormData();
          form.set("photo", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), photo.file);
          const fields = {
            clientCaptureId: randomUUID(), slotId: slot.id, nonce: slot.nonce,
            sha256: createHash("sha256").update(image).digest("hex"),
            claimedCapturedAt: new Date(capturedAt).toISOString(),
            elapsedMs: capturedAt - Date.parse(session.serverTimeAnchor), bootId, deviceId,
          };
          for (const [key, value] of Object.entries(fields)) form.set(key, String(value));

          const start = performance.now();
          const result = await request<Upload>(sessionPath + "/attempts", staffAuth, 200, form);
          const uploadMs = Math.round(performance.now() - start);
          const attempt = await prisma.verificationAttempt.findUniqueOrThrow({
            where: { id: result.attemptId },
            include: { media: true, requirement: true },
          });
          assert.equal(attempt.sessionId, session.id);
          assert.equal(attempt.requirement?.id, requirementSlot.requirementId);
          assert.equal(attempt.requirement?.currentAttemptId, attempt.id);
          assert.equal(attempt.requirement?.state, result.state);
          const direct = attempt.directAssessment as { assessment: Assessment } | null;
          const decision = attempt.cleanlinessResult as Assessment | null;
          assert.ok(direct && decision, "Both saved assessments are required");
          assert.equal(decision.metadata.provider, "cloudflare");
          assert.deepEqual(decision.metadata, direct.assessment.metadata);
          return { result, attempt, answers: decision.metadata.screeningAnswers, uploadMs };
        }

        const decisions = {
          CLEAN: { state: "PASSED", reasonCode: "CLEAN" },
          DIRTY: { state: "CLEANING_REQUIRED", reasonCode: "CLEANING_REQUIRED" },
          REVIEW: { state: "REVIEW_REQUIRED", reasonCode: "CANNOT_ASSESS" },
        };
        function assertDecision(result: Upload, band: Band) {
          assert.equal(result.state, decisions[band].state);
          assert.equal(result.reasonCode, decisions[band].reasonCode);
          assert.equal(result.storage, "cloud");
        }
        function visibilityKeys(photo: Photo) {
          return Array.from({ length: views[photo.fixtureType].visibilityCount }, (_, i) => `visible_surface_${i}`);
        }

        const scoredPhotos = [clean, dirty, middle, mirror];
        for (const [index, photo] of scoredPhotos.entries()) {
          const label = `E${index + 1}`;
          const requestsBefore = modelRequests;
          const { result, attempt, answers, uploadMs } = await upload(label, photo);
          assert.equal(modelRequests, requestsBefore + 1, `${label} calls the service once`);
          assertDecision(result, photo.band);
          const score = answers.cleanlinessModel;
          assert.ok(score);
          assert.equal(score.status, "SCORED");
          assert.equal(score.band, photo.band);
          assert.equal(score.modelVersion, modelVersion);
          assert.equal(score.reason, null);
          assert.equal(score.fixtureType, photo.fixtureType);
          assert.equal(answers.cleanliness, undefined);
          assert.ok(typeof score.pDirty === "number" && Math.abs(score.pDirty - photo.pDirty) < 0.001);
          assert.ok(Number.isInteger(score.latencyMs) && score.latencyMs >= 0);
          if (photo.band === "DIRTY") {
            assert.equal(attempt.media?.privacyState, "NOT_REQUIRED");
            assert.ok(attempt.media && assets.has(attempt.media.originalPublicId));
          }
          console.log(`${label} PASS: ${photo.fixtureType} ${result.state}, pDirty=${score.pDirty.toFixed(6)}, model=${score.latencyMs} ms, upload=${uploadMs} ms`);
        }

        await model.stop();
        const callsBeforeDown = modelRequests;
        const down = await upload("E5", clean);
        assertDecision(down.result, "REVIEW");
        assert.equal(modelRequests, callsBeforeDown + 1);
        const unavailable = down.answers.cleanlinessModel;
        assert.ok(unavailable);
        assert.equal(unavailable.status, "UNAVAILABLE");
        assert.equal(unavailable.reason, "CONNECTION_ERROR");
        assert.equal(unavailable.pDirty, null);
        assert.equal(unavailable.band, null);
        assert.equal(unavailable.modelVersion, null);
        assert.equal(down.answers.cleanliness, undefined);
        console.log(`E5 PASS: HTTP 200 ${down.result.state}, model unavailable in ${unavailable.latencyMs} ms, upload=${down.uploadMs} ms`);

        assert.deepEqual(clefRequests, [...scoredPhotos, clean].map((photo) => ["originality", "object_match", ...visibilityKeys(photo)]));
        console.log("E6 PASS: all five local-mode CLEF requests contain screening questions only");

        delete process.env.CLEANLINESS_PROVIDER;
        const callsBeforeClef = modelRequests;
        const legacy = await upload("E7", clean);
        assertDecision(legacy.result, "CLEAN");
        assert.equal(modelRequests, callsBeforeClef);
        assert.equal(clefRequests.length, 6);
        const visible = visibilityKeys(clean);
        const cleanliness = visible.map((key) => key.replace("visible_", ""));
        assert.deepEqual(clefRequests[5], ["originality", "object_match", ...visible.flatMap((key, i) => [key, cleanliness[i]])]);
        assert.deepEqual(Object.entries(legacy.answers.cleanliness ?? {}).map(([key, answer]) => [key, answer.choice]),
          cleanliness.map((key) => [key, "CLEAN"]));
        assert.equal(legacy.answers.cleanlinessModel, undefined);
        console.log(`E7 PASS: default CLEF asked cleanliness questions, no local model call, upload=${legacy.uploadMs} ms`);
      } finally {
        globalThis.fetch = nativeFetch;
        await model.stop();
        console.log(`Cleanup PASS: model port ${new URL(model.origin).port} is closed`);
      }
    } finally {
      await close(server);
    }
  } finally {
    await prisma.$disconnect();
  }
}

await withDatabase(runIntegration);
