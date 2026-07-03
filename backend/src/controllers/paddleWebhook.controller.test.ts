import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  unmarshal: vi.fn(),
  processPaddleEvent: vi.fn(),
}));

vi.mock("../config/paddle.js", () => ({
  getPaddleClient: () => ({ webhooks: { unmarshal: mocks.unmarshal } }),
  getPaddleWebhookSecret: () => "test_signing_secret",
}));

vi.mock("../services/paddleFulfillment.service.js", () => ({
  processPaddleEvent: mocks.processPaddleEvent,
}));

import { handlePaddleWebhook } from "./paddleWebhook.controller.js";

const responseDouble = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
};

describe("handlePaddleWebhook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the untouched raw body to Paddle before processing the event", async () => {
    const rawBody = Buffer.from('{"event_type":"customer.created"}');
    const event = { eventId: "evt_1", eventType: "customer.created" };
    mocks.unmarshal.mockResolvedValue(event);
    mocks.processPaddleEvent.mockResolvedValue({ duplicate: false });
    const response = responseDouble();
    const next = vi.fn();

    await handlePaddleWebhook(
      { headers: { "paddle-signature": "ts=1;h1=signature" }, body: rawBody } as unknown as Request,
      response as unknown as Response,
      next as NextFunction,
    );

    expect(mocks.unmarshal).toHaveBeenCalledWith(
      rawBody.toString("utf8"),
      "test_signing_secret",
      "ts=1;h1=signature",
    );
    expect(mocks.processPaddleEvent).toHaveBeenCalledWith(event);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature without running fulfillment", async () => {
    mocks.unmarshal.mockRejectedValue(new Error("invalid signature"));
    const response = responseDouble();

    await handlePaddleWebhook(
      { headers: { "paddle-signature": "invalid" }, body: Buffer.from("{}") } as unknown as Request,
      response as unknown as Response,
      vi.fn() as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.processPaddleEvent).not.toHaveBeenCalled();
  });

  it("rejects a body that has already been parsed", async () => {
    const response = responseDouble();

    await handlePaddleWebhook(
      { headers: { "paddle-signature": "signature" }, body: {} } as unknown as Request,
      response as unknown as Response,
      vi.fn() as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.unmarshal).not.toHaveBeenCalled();
    expect(mocks.processPaddleEvent).not.toHaveBeenCalled();
  });
});
