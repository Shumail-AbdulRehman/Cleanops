import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { getLocationMapConfig } from "./mapConfig.controller.js";

afterEach(() => vi.unstubAllEnvs());
function response() {
  return { setHeader: vi.fn(), json: vi.fn() };
}
describe("location browser map configuration", () => {
  it("uses only the browser credential when supplied and prevents caching", () => {
    vi.stubEnv("GOOGLE_MAP_BROWSER_API_KEY", "browser-test-key");
    vi.stubEnv("GOOGLE_MAP_API_KEY", "server-test-key");
    vi.stubEnv("GOOGLE_MAP_ID", "site-map-id");
    const res = response();
    getLocationMapConfig({} as Request, res as unknown as Response);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { enabled: true, apiKey: "browser-test-key", mapId: "site-map-id" } });
  });
  it("supports the existing backend key without returning other environment configuration", () => {
    vi.stubEnv("GOOGLE_MAP_BROWSER_API_KEY", "");
    vi.stubEnv("GOOGLE_MAP_API_KEY", " existing-test-key ");
    vi.stubEnv("GOOGLE_MAP_ID", "");
    const res = response();
    getLocationMapConfig({} as Request, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { enabled: true, apiKey: "existing-test-key", mapId: "DEMO_MAP_ID" } });
  });
  it("reports missing configuration without breaking the manual form", () => {
    vi.stubEnv("GOOGLE_MAP_BROWSER_API_KEY", ""); vi.stubEnv("GOOGLE_MAP_API_KEY", "");
    vi.stubEnv("GOOGLE_MAP_ID", "");
    const res = response(); getLocationMapConfig({} as Request, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { enabled: false, apiKey: null, mapId: "DEMO_MAP_ID" } });
  });
});
