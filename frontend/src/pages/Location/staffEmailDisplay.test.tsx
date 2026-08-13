import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import TaskWorker from "@/components/common/TaskWorker";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import LocationStaffTab, { type LocationStaffTabProps } from "./LocationStaffTab";

const locationInfo: LocationStaffTabProps["locationInfo"] = {
  id: 1,
  name: "North site",
  timezone: "Asia/Karachi",
  isActive: false,
  staff: [
    { id: 1, name: "Amina Khan", email: "amina@example.test", shiftStart: null, shiftEnd: null, isActive: true },
    { id: 2, name: "Bilal Shah", email: null, shiftStart: null, shiftEnd: null, isActive: true },
  ],
};

function renderLocationStaff(language: Language = "en") {
  render(
    <LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}>
      <MemoryRouter>
        <LocationStaffTab
          locationInfo={locationInfo}
          locationTz={locationInfo.timezone}
          staffAdded={false}
          setStaffAdded={() => {}}
          staffDialogOpen={false}
          setStaffDialogOpen={() => {}}
        />
      </MemoryRouter>
    </LanguageContext.Provider>,
  );
}

describe("Missing staff email", () => {
  it("shows No email beside the staff member and sorts a missing email as empty text", () => {
    renderLocationStaff();
    const table = within(screen.getByRole("table"));
    const row = table.getByRole("row", { name: /Bilal Shah/ });
    expect(within(row).getByRole("cell", { name: "No email" })).toBeVisible();
    expect(table.queryByText("null", { exact: false })).not.toBeInTheDocument();

    const email = table.getByRole("columnheader", { name: "Email" });
    const sort = within(email).getByRole("button", { name: "Email" });
    fireEvent.click(sort);
    expect(email).toHaveAttribute("aria-sort", "ascending");
    expect(table.getAllByRole("row")[1]).toBe(row);

    fireEvent.click(sort);
    expect(email).toHaveAttribute("aria-sort", "descending");
    expect(table.getAllByRole("row")[2]).toBe(row);
  });

  it("shows the Urdu placeholder in the location table", () => {
    renderLocationStaff("ur");
    expect(screen.getByRole("cell", { name: "ای میل درج نہیں" })).toBeVisible();
  });

  it.each([
    { description: "omitted", staff: { id: 2, name: "Bilal Shah" } },
    { description: "null", staff: { id: 2, name: "Bilal Shah", email: null } },
  ])("shows the task worker's name and omits the email line when email is $description", ({ staff }) => {
    render(<TaskWorker details task={{ staffId: staff.id, staff }} />);
    expect(screen.getByText("Bilal Shah")).toBeVisible();
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
  });
});
