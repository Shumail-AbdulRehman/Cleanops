import { client } from "../../api/client.js";
import type { CreateLocationInput } from "./types.js";

export const getLocations = async (includeInactive = false, signal?: AbortSignal) => {
  const res = await client.get("/location/", {
    params: includeInactive ? { includeInactive: true } : undefined,
    signal,
  });
  return res.data;
};

export const createLocation = async (data: CreateLocationInput) => {
  const res = await client.post(
    "/location/",
    { data },
    { withCredentials: true },
  );
  return res.data;
};

export type LocationStatsFilter =
  | { type: "days"; days: number }
  | { type: "range"; dateFrom: string; dateTo: string };

export const getLocationById = async (
  id: string,
  filter?: LocationStatsFilter,
) => {
  const params: Record<string, string | number> = {};

  if (filter?.type === "days") {
    params.days = filter.days;
  } else if (filter?.type === "range") {
    params.dateFrom = filter.dateFrom;
    params.dateTo = filter.dateTo;
  }

  const res = await client.get(`/location/${id}/stats`, { params });
  return res.data;
};
export const deleteLocation = async (id: number) => {
  const res = await client.delete(`/location/${id}`);
  return res.data;
};

export const updateLocation = async ({
  id,
  data,
}: {
  id: number;
  data: CreateLocationInput;
}) => {
  return (await client.patch(`/location/${id}`, { data })).data;
};
export const getLocationMapConfig = async () => {
  return (
    await client.get<{
      data: { enabled: boolean; apiKey: string | null; mapId: string };
    }>("/location/map-config")
  ).data.data;
};

export const getLocationSchedule = async (
  id: string,
  week: string | undefined,
  signal?: AbortSignal,
) => {
  const res = await client.get<{
    data: import("./scheduleTypes").LocationSchedule;
  }>(`/location/${id}/schedule`, {
    params: week ? { week } : {},
    signal,
  });
  return res.data.data;
};
