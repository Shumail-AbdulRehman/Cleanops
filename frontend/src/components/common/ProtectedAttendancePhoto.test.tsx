import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), revoke: vi.fn(), user: { id: 1, companyId: 42, role: "ADMIN" } as { id: number; companyId: number; role: string } | null }));
vi.mock("@/api/client", () => ({ client: { get: mock.get } }));
vi.mock("@/hooks/useAuth", () => ({ default: () => ({ user: mock.user }) }));
import ProtectedAttendancePhoto, { type AttendancePhoto } from "./ProtectedAttendancePhoto";
import { LanguageProvider } from "@/i18n/LanguageProvider";
const available: AttendancePhoto = { state: "AVAILABLE", path: "/attendance/12/photos/check-in" };
const photo = () => <ProtectedAttendancePhoto attendanceId={12} kind="check-in" photo={available} />;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mock.user = { id: 1, companyId: 42, role: "ADMIN" };
  mock.create.mockReturnValue("blob:protected-attendance");
  const OriginalURL = URL;
  vi.stubGlobal("URL", class extends OriginalURL { static createObjectURL = mock.create; static revokeObjectURL = mock.revoke; });
  mock.get.mockResolvedValue({ data: new Blob(["test-photo-bytes"], { type: "image/jpeg" }) });
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
async function openPhoto() { fireEvent.click(screen.getByRole("button", { name: "View check-in photo" })); }
describe("protected attendance photo", () => {
  it("fetches through credentialed application client only after the accessible action opens", async () => {
    render(photo()); expect(mock.get).not.toHaveBeenCalled();
    await openPhoto();
    expect(await screen.findByRole("img", { name: "Check-in photo" })).toHaveAttribute("src", "blob:protected-attendance");
    expect(mock.get).toHaveBeenCalledWith("/attendance/12/photos/check-in", { responseType: "blob", signal: expect.any(AbortSignal) });
    expect(screen.getByRole("dialog", { name: "Check-in photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("img")).toHaveStyle({ width: "150%" });
  });
  it("shows unavailable legacy context and never follows a public URL", () => {
    render(<ProtectedAttendancePhoto attendanceId={12} kind="check-in" photo={{ state: "LEGACY_RESTRICTED", path: "https://public.invalid/selfie.jpg" }} />);
    expect(screen.getByText("This earlier photo is unavailable. The attendance record is unchanged.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(mock.get).not.toHaveBeenCalled();
  });
  it("does not follow an arbitrary path even when the metadata claims available", () => {
    render(<ProtectedAttendancePhoto attendanceId={12} kind="check-in" photo={{ state: "AVAILABLE", path: "https://evil.invalid/private" }} />);
    expect(screen.getByText("No photo recorded.")).toBeInTheDocument(); expect(mock.get).not.toHaveBeenCalled();
  });
  it("distinguishes no photo from loading without fabricating an image", () => {
    render(<ProtectedAttendancePhoto attendanceId={12} kind="check-out" photo={{ state: "NONE", path: null }} />);
    expect(screen.getByText("No photo recorded.")).toBeInTheDocument(); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("shows loading and supports retry after a provider or network failure", async () => {
    let fail!: (error: Error) => void;
    mock.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    render(photo()); await openPhoto(); expect(screen.getByRole("status")).toHaveTextContent("Loading attendance photo…");
    await act(async () => fail(new Error("offline")));
    expect(await screen.findByRole("alert")).toHaveTextContent("The photo could not load. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("img")).toBeInTheDocument(); expect(mock.get).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 404])("reports HTTP %i without retrying forbidden or missing bytes", async status => {
    mock.get.mockRejectedValueOnce(Object.assign(new Error("denied"), { isAxiosError: true, response: { status } }));
    render(photo()); await openPhoto();
    expect(await screen.findByRole("alert")).toHaveTextContent(status === 404 ? "Photo unavailable. The attendance record is unchanged." : "You no longer have access to this photo.");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument(); expect(mock.create).not.toHaveBeenCalled();
  });
  it("releases bytes and aborts request when closed, then returns focus to its trigger", async () => {
    render(photo()); const trigger = screen.getByRole("button", { name: "View check-in photo" });
    await openPhoto(); await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.revoke).toHaveBeenCalledWith("blob:protected-attendance");
    expect(mock.get.mock.calls[0]![1].signal.aborted).toBe(true);
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("discards a late response after unmount without allocating a blob URL", async () => {
    let resolve!: (value: { data: Blob }) => void;
    mock.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(photo()); await openPhoto(); view.unmount();
    await act(async () => resolve({ data: new Blob(["late"], { type: "image/jpeg" }) }));
    expect(mock.create).not.toHaveBeenCalled(); expect(mock.get.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it("clears the old photo when authenticated company or principal changes", async () => {
    const view = render(photo()); await openPhoto(); await screen.findByRole("img");
    mock.user = { id: 1, companyId: 99, role: "ADMIN" }; view.rerender(photo());
    expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(mock.revoke).toHaveBeenCalledWith("blob:protected-attendance");
    expect(mock.get).toHaveBeenCalledTimes(1);
    mock.user = null; view.rerender(photo()); expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("rejects non-image responses and handles browser image decode failure", async () => {
    mock.get.mockResolvedValueOnce({ data: new Blob(["not-an-image"], { type: "application/json" }) });
    render(photo()); await openPhoto(); await screen.findByRole("alert"); expect(mock.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    const image = await screen.findByRole("img"); fireEvent.error(image);
    expect(screen.getByRole("alert")).toHaveTextContent("The photo could not load. Try again.");
  });
  it("provides translated Urdu action/title/loading/close with RTL provider", async () => {
    localStorage.setItem("hygene-ops.language", "ur");
    render(<LanguageProvider>{photo()}</LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "حاضری کی تصویر دیکھیں" }));
    expect(await screen.findByRole("dialog", { name: "حاضری کی تصویر" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "حاضری کی تصویر" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "بند کریں" })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("rtl");
  });
});
