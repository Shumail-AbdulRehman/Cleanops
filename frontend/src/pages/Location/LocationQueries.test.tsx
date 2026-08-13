import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useGetLocations } from "./queries";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/client", () => ({ client: { get: api.get } }));

function Lists() {
  const active = useGetLocations();
  const directory = useGetLocations(true);
  return <><output aria-label="Operational sites">{JSON.stringify(active.data?.data)}</output><output aria-label="Directory sites">{JSON.stringify(directory.data?.data)}</output></>;
}

it("requests inactive records only for the directory and never reuses them in operational selectors", async () => {
  api.get.mockImplementation(async (_url, options) => ({ data: { data: options.params?.includeInactive ? ["Active site", "Retained inactive site"] : ["Active site"] } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><Lists /></QueryClientProvider>);
  await screen.findByText('["Active site","Retained inactive site"]');
  expect(screen.getByLabelText("Operational sites")).toHaveTextContent('["Active site"]');
  expect(api.get).toHaveBeenCalledWith("/location/", { params: { includeInactive: true }, signal: expect.any(AbortSignal) });
  expect(api.get).toHaveBeenCalledWith("/location/", { params: undefined, signal: expect.any(AbortSignal) });
});
