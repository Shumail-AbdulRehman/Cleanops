import type { NextFunction, Request, Response } from "express";
import { getPaddleClient, getPaddleWebhookSecret } from "../config/paddle.js";
import { processPaddleEvent } from "../services/paddleFulfillment.service.js";

export const handlePaddleWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const signatureHeader = req.headers["paddle-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!signature || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ message: "Missing Paddle signature or raw request body" });
  }

  let paddle;
  let secret;
  try {
    paddle = getPaddleClient();
    secret = getPaddleWebhookSecret();
  } catch (error) {
    return next(error);
  }

  let event;
  try {
    event = await paddle.webhooks.unmarshal(req.body.toString("utf8"), secret, signature);
  } catch {
    return res.status(400).json({ message: "Invalid Paddle webhook signature" });
  }

  try {
    const result = await processPaddleEvent(event);
    return res.status(200).json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    return next(error);
  }
};
