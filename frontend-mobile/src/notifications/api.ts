import { client, accountRequest } from "../api/client";

// Push taps acknowledge delivery without fetching an inbox or delaying navigation.
export const acknowledgePhoneAlert = (id: number, scope: string) =>
  client.post(`/staff-notifications/${id}/read`, undefined, accountRequest(scope));
