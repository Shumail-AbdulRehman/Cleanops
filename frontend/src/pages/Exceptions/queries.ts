import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
const useScope = () =>
  useSelector(
    (s: RootState) =>
      `${s.auth.user?.companyId}:${s.auth.user?.role}:${s.auth.user?.id}`,
  );
import { useQuery } from "@tanstack/react-query";
import { client } from "@/api/client";
import { getException } from "./api";
export const useException = (id: number) => {
  const scope = useScope();
  return useQuery({
    queryKey: ["exception", scope, id],
    queryFn: () => getException(id),
    enabled: id > 0,
    refetchInterval: (query) =>
      query.state.data?.items?.some((i) =>
        i.requirements.some((r) => r.state === "PROCESSING"),
      )
        ? 5000
        : 30000,
    refetchIntervalInBackground: false,
  });
};
export const useExceptionCount = (enabled = true) => {
  const scope = useScope();
  return useQuery({
    queryKey: ["exception-count", scope],
    queryFn: async ({ signal }) =>
      (
        await client.get<{ data: { total: number } }>(
          "/verification-exceptions/count",
          { params: { queue: "needs-me" }, signal },
        )
      ).data.data,
    enabled,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
};
