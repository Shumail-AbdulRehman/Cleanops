import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SocialLinks } from "./SocialLinks";

it.each([
  ["Email Hygene Ops at hygeneops@gmail.com", "mailto:hygeneops@gmail.com"],
  ["Hygene Ops on Instagram", "https://www.instagram.com/hygeneops/"],
  ["Hygene Ops on Facebook", "https://www.facebook.com/profile.php?id=61596747781936"],
  ["Hygene Ops on YouTube", "https://www.youtube.com/@Hygeneops"],
])("renders the accessible footer link %s", (label, href) => {
  render(<SocialLinks />);

  const link = screen.getByRole("link", { name: label });
  expect(link).toHaveAttribute("aria-label", label);
  expect(link).toHaveAttribute("href", href);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});
