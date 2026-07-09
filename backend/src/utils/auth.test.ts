import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { generateAccessToken, generateRefreshToken, verifySessionToken } from "./auth.js";
beforeEach(() => {
  vi.stubEnv("ACCESS_TOKEN_SECRET", "test-access-key"); vi.stubEnv("REFRESH_TOKEN_SECRET", "test-refresh-key");
  vi.stubEnv("ACCESS_TOKEN_EXPIRY", "15m"); vi.stubEnv("REFRESH_TOKEN_EXPIRY", "7d");
});
afterEach(() => vi.unstubAllEnvs());
describe("tenant JWT contracts", () => {
  it("signs a staff access token with a null email", () => {
    const token = generateAccessToken({ id: 1, email: null, name: "Test" }, "STAFF");
    expect(verifySessionToken(token, "access")).toMatchObject({ id: 1, email: null, role: "STAFF" });
  });
  it.each(["ADMIN", "MANAGER", "STAFF"] as const)("issues distinct same-second refresh tokens for %s", role => {
    const first = generateRefreshToken({ id: 1 }, role), second = generateRefreshToken({ id: 1 }, role);
    expect(first).not.toBe(second);
    expect(verifySessionToken(first, "refresh")).toMatchObject({ id: 1, role, tokenUse: "refresh", jti: expect.any(String) });
    const access = generateAccessToken({ id: 1, email: "test@example.invalid", name: "Test" }, role);
    expect(verifySessionToken(access, "access")).toMatchObject({ id: 1, role, tokenUse: "access" });
  });
  it.each([0, -1, 1.5, "1", null])("rejects malformed numeric identity %j", id => {
    const token = jwt.sign({ id, role: "STAFF", tokenUse: "access" }, "test-access-key", { expiresIn: "15m" });
    expect(() => verifySessionToken(token, "access")).toThrow("Access Token Expired");
  });
  it.each(["SUPERADMIN", "OPERATOR", "staff", null])("rejects foreign/invalid tenant role %j", role => {
    const token = jwt.sign({ id: 1, role, tokenUse: "access" }, "test-access-key", { expiresIn: "15m" });
    expect(() => verifySessionToken(token, "access")).toThrow();
  });
  it("requires purpose and expiry, and rejects pre-patch untyped tokens", () => {
    for (const claims of [{ id: 1, role: "STAFF" }, { id: 1, role: "STAFF", tokenUse: "access" }]) {
      expect(() => verifySessionToken(jwt.sign(claims, "test-access-key"), "access")).toThrow();
    }
  });
  it("rejects refresh at access endpoints even with accidentally equal keys", () => {
    vi.stubEnv("REFRESH_TOKEN_SECRET", "test-access-key");
    expect(() => verifySessionToken(generateRefreshToken({ id: 1 }, "STAFF"), "access")).toThrow();
  });
  it("pins HS256 and requires a refresh nonce", () => {
    const claims = { id: 1, role: "STAFF", tokenUse: "refresh" };
    expect(() => verifySessionToken(jwt.sign(claims, "test-refresh-key", { expiresIn: "7d" }), "refresh")).toThrow();
    const wrongAlgorithm = jwt.sign({ id: 1, role: "STAFF", tokenUse: "access" }, "test-access-key", { algorithm: "HS384", expiresIn: "15m" });
    expect(() => verifySessionToken(wrongAlgorithm, "access")).toThrow();
  });
});
it("binds access and refresh claims to the real credential epoch", () => {
  const user = { id: 1, name: "Test", email: "test@example.invalid", credentialVersion: 4 };
  expect(verifySessionToken(generateAccessToken(user, "ADMIN"), "access").credentialVersion).toBe(4);
  expect(verifySessionToken(generateRefreshToken(user, "ADMIN"), "refresh").credentialVersion).toBe(4);
});
it.each([-1, 1.5, null, "0"])("rejects malformed signed credential epoch %j", credentialVersion => {
  const token = jwt.sign({ id: 1, role: "STAFF", tokenUse: "access", credentialVersion }, "test-access-key", { expiresIn: "15m" });
  expect(() => verifySessionToken(token, "access")).toThrow();
});
