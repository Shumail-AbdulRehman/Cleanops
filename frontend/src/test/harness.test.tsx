import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../components/ui/button";

describe("existing UI component harness", () => {
  it("exposes an accessible action and supports keyboard-focusable native button semantics", () => {
    const click = vi.fn(); render(<Button onClick={click}>Save changes</Button>);
    const button = screen.getByRole("button", { name: "Save changes" });
    button.focus(); expect(button).toHaveFocus();
    fireEvent.click(button); expect(click).toHaveBeenCalledTimes(1);
  });
  it("prevents activation while the real existing Button is disabled", () => {
    const click = vi.fn(); render(<Button disabled onClick={click}>Saving…</Button>);
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled(); fireEvent.click(button); expect(click).not.toHaveBeenCalled();
  });
});
