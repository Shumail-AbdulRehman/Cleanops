import type { Request, Response } from "express";

/** Browser Maps credentials are public; restrict HTTP referrers in Google Cloud. */
export const getLocationMapConfig = (_req: Request, res: Response) => {
  const apiKey = (process.env.GOOGLE_MAP_BROWSER_API_KEY || process.env.GOOGLE_MAP_API_KEY || "").trim();
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ success: true, data: {
    enabled: Boolean(apiKey), apiKey: apiKey || null,
    mapId: process.env.GOOGLE_MAP_ID?.trim() || "DEMO_MAP_ID",
  } });
};
