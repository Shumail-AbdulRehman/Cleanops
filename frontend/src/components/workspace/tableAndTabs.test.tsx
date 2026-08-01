import { useState, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DataTable, { type Column } from "@/components/common/DataTable";
import Pagination from "@/components/common/Pagination";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import { WorkspaceTabs, WorkspaceTabPanel, type WorkspaceTab } from "./WorkspaceTabs";

function Language({ children, language = "en" }: { children: ReactNode; language?: Language }) {
  return <LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}>
    <div className="workspace" dir={language === "ur" ? "rtl" : "ltr"} lang={language === "ur" ? "ur-PK" : "en-PK"}>{children}</div>
  </LanguageContext.Provider>;
}
const data = [{ id: 1, name: "Record B", total: 10 }, { id: 2, name: "Record A", total: 2 }, { id: 3, name: "Record C", total: 30 }];
type RecordRow = typeof data[number];
const columns: Column<RecordRow>[] = [
  { key: "name", header: "Name", render: row => <strong>{row.name}</strong>, sortValue: row => row.name, className: "record-name" },
  { key: "total", header: "Tasks", render: row => row.total, sortValue: row => row.total },
  { key: "actions", header: "Actions", render: row => <a href={`#record-${row.id}`}><span>Open {row.name}</span></a> },
];
function tableNames() { return within(screen.getByRole("table")).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell")[0].textContent); }

describe("DataTable compatibility and cards", () => {
  it("keeps columns, cell renderers, column classes and the supplied region class", () => {
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} className="caller-table" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map(el => el.textContent)).toEqual(["Name", "Tasks", "Actions"]);
    expect(tableNames()).toEqual(["Record B", "Record A", "Record C"]);
    expect(within(table).getByRole("cell", { name: "Record B" })).toHaveClass("record-name");
    expect(screen.getByRole("region", { name: "Name table" })).toHaveClass("caller-table");
  });

  it("retains custom mobile renderers until a caller explicitly chooses cards", () => {
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} mobileRender={row => <p>Custom {row.name}</p>} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("Custom Record B")).toBeVisible();
  });

  it("retains legacy expandable mobile summaries and their row action", () => {
    const onRowClick = vi.fn();
    render(<DataTable data={data.slice(0, 1)} columns={columns} rowKey={row => row.id} onRowClick={onRowClick} />);
    const summary = screen.getByRole("article");
    expect(within(summary).getByText("Show details")).toBeInTheDocument();
    fireEvent.click(within(summary).getByRole("button", { name: "Open details" }));
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(data[0]);
  });

  it("cards expose every original cell with a visual label and no duplicate mobile record", () => {
    render(<DataTable data={data.slice(0, 1)} columns={columns} rowKey={row => row.id} mobileCards mobileRender={() => <p>Legacy custom content</p>} />);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy custom content")).not.toBeInTheDocument();
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells).toHaveLength(3);
    for (const [index, cell] of cells.entries()) expect(within(cell).getByText(columns[index].header)).toHaveAttribute("aria-hidden", "true");
    expect(within(cells[2]).getByRole("link", { name: "Open Record B" })).toHaveAttribute("href", "#record-1");
  });

  it("cycles string sorting ascending, descending and original without mutating input", () => {
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} mobileCards />);
    const sort = screen.getByRole("button", { name: "Name" });
    const header = screen.getByRole("columnheader", { name: "Name" });
    fireEvent.click(sort);
    expect(tableNames()).toEqual(["NameRecord A", "NameRecord B", "NameRecord C"]);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(sort);
    expect(tableNames()).toEqual(["NameRecord C", "NameRecord B", "NameRecord A"]);
    expect(header).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(sort);
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(tableNames()).toEqual(["NameRecord B", "NameRecord A", "NameRecord C"]);
    expect(data.map(row => row.id)).toEqual([1, 2, 3]);
  });

  it("sorts numeric values numerically and resets pagination on sorting", () => {
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} pageSize={1} mobileCards />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(tableNames()).toEqual(["NameRecord A"]);
    expect(screen.getByText("Page 1 of 3")).toBeVisible();
  });

  it("keeps mobile sorting and the default order available in card mode", () => {
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} pageSize={1} mobileCards />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "name" } });
    expect(tableNames()).toEqual(["NameRecord A"]);
    expect(screen.getByText("Page 1 of 3")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "" } });
    expect(tableNames()).toEqual(["NameRecord B"]);
  });

  it("clamps the current page when records shrink and exposes correct range boundaries", () => {
    const { rerender } = render(<DataTable data={data} columns={columns} rowKey={row => row.id} pageSize={1} mobileCards />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("3–3 of 3")).toBeVisible();
    rerender(<DataTable data={data.slice(0, 2)} columns={columns} rowKey={row => row.id} pageSize={1} mobileCards />);
    expect(tableNames()).toEqual(["NameRecord A"]);
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(tableNames()).toEqual(["NameRecord B"]);
  });

  it("keeps expanded content accessible alongside the correct record", () => {
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} mobileCards expandedRow={row => row.id === 2 ? <p>Expanded record A</p> : null} />);
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.getByRole("cell", { name: "Expanded record A" })).toHaveAttribute("colspan", "3");
  });

  it("renders the supplied empty message and icon without a table or pager", () => {
    render(<DataTable data={[]} columns={columns} rowKey={row => row.id} pageSize={1} emptyMessage="No matching records" emptyIcon={<span>Empty icon</span>} />);
    expect(screen.getByText("No matching records")).toBeVisible();
    expect(screen.getByText("Empty icon")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("translates headers, card labels and pagination while preserving record text", () => {
    render(<Language language="ur"><DataTable data={data} columns={columns} rowKey={row => row.id} pageSize={1} mobileCards /></Language>);
    expect(screen.getByRole("columnheader", { name: translate("Name", "ur") })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Record B" })).toBeVisible();
    expect(screen.getByRole("button", { name: translate("Next", "ur") })).toBeVisible();
    expect(screen.getByRole("table").closest(".workspace")).toHaveAttribute("dir", "rtl");
  });
});

describe("DataTable row activation", () => {
  it("activates a clicked cell and preserves hover prefetch", () => {
    const click = vi.fn(), hover = vi.fn();
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} onRowClick={click} onRowHover={hover} mobileCards />);
    const row = screen.getByRole("row", { name: /Record B/ });
    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByText("Record B"));
    expect(hover).toHaveBeenCalledExactlyOnceWith(data[0]);
    expect(click).toHaveBeenCalledExactlyOnceWith(data[0]);
  });

  it.each(["Enter", " "])("activates the focused row with %s", key => {
    const click = vi.fn();
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} onRowClick={click} mobileCards />);
    const row = screen.getByRole("row", { name: /Record B/ });
    expect(row).toHaveAttribute("tabindex", "0");
    row.focus();
    fireEvent.keyDown(row, { key });
    expect(click).toHaveBeenCalledExactlyOnceWith(data[0]);
  });

  it("does not add row tab stops or selection when no interaction is requested", () => {
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} mobileCards />);
    const row = screen.getByRole("row", { name: /Record B/ });
    expect(row).not.toHaveAttribute("tabindex");
    expect(row).not.toHaveAttribute("aria-selected");
  });

  it("keeps inner links clickable and keyboard reachable without activating the row", () => {
    const click = vi.fn();
    render(<DataTable data={data} columns={columns} rowKey={row => row.id} onRowClick={click} mobileCards />);
    const link = screen.getByRole("link", { name: "Open Record B" });
    link.focus();
    expect(link).toHaveFocus();
    fireEvent.click(within(link).getByText("Open Record B"));
    fireEvent.keyDown(link, { key: "Enter" });
    expect(click).not.toHaveBeenCalled();
    expect(link).toHaveAttribute("href", "#record-1");
  });

  it.each([
    <button type="button">Inner action</button>,
    <label>Inner action<input type="checkbox" /></label>,
    <select aria-label="Inner action"><option>Choose</option></select>,
    <textarea aria-label="Inner action" />,
    <details><summary>Inner action</summary>Details</details>,
    <span role="button" tabIndex={0}>Inner action</span>,
    <span contentEditable suppressContentEditableWarning>Inner action</span>,
  ])("does not hijack an embedded control (%#)", control => {
    const click = vi.fn();
    render(<DataTable data={data.slice(0, 1)} columns={[{ key: "control", header: "Actions", render: () => control }]} rowKey={row => row.id} onRowClick={click} mobileCards />);
    const inner = screen.queryByText("Inner action") ?? screen.getByLabelText("Inner action");
    fireEvent.click(inner);
    fireEvent.keyDown(inner, { key: "Enter" });
    expect(click).not.toHaveBeenCalled();
  });

  it("exposes controlled selected and unselected rows and updates from props", () => {
    const { rerender } = render(<DataTable data={data} columns={columns} rowKey={row => row.id} selectedRowKey={2} mobileCards />);
    expect(screen.getByRole("row", { name: /Record A/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Record B/, selected: false })).toBeInTheDocument();
    rerender(<DataTable data={data} columns={columns} rowKey={row => row.id} selectedRowKey={null} mobileCards />);
    expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
  });
});

describe("Pagination", () => {
  const defaults = { page: 1, pageSize: 20, total: 45, totalPages: 3, onPage: vi.fn(), onSize: vi.fn() };
  it("reports page changes and size changes without changing controlled values", () => {
    const onPage = vi.fn(), onSize = vi.fn();
    render(<Pagination {...defaults} page={2} onPage={onPage} onSize={onSize} />);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
    expect(screen.getByText("21–40 of 45")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage.mock.calls).toEqual([[1], [3]]);
    fireEvent.change(screen.getByRole("combobox", { name: "Per page" }), { target: { value: "50" } });
    expect(onSize).toHaveBeenCalledExactlyOnceWith(50);
    expect(screen.getByRole("combobox")).toHaveValue("20");
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
  });
  it("disables boundaries and shows the final partial page", () => {
    const { rerender } = render(<Pagination {...defaults} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    rerender(<Pagination {...defaults} page={3} />);
    expect(screen.getByText("41–45 of 45")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
  it("shows an empty range and disables both controls for an empty result", () => {
    render(<Pagination {...defaults} total={0} totalPages={0} />);
    expect(screen.getByText("0–0 of 0")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
  it("does not accidentally submit a surrounding form", () => {
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><Pagination {...defaults} /><DataTable data={data} columns={columns} rowKey={row => row.id} pageSize={1} mobileCards /></form>);
    for (const button of screen.getAllByRole("button")) fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });
  it("translates all interface controls into Urdu", () => {
    render(<Language language="ur"><Pagination {...defaults} /></Language>);
    expect(screen.getByRole("navigation", { name: translate("Pagination", "ur") })).toBeVisible();
    expect(screen.getByRole("combobox", { name: translate("Per page", "ur") })).toBeVisible();
    expect(screen.getByRole("button", { name: translate("Next", "ur") })).toBeVisible();
  });
});

const tabs: WorkspaceTab[] = [{ value: "tasks", label: "Tasks", count: 0 }, { value: "disabled", label: "Reviewed", disabled: true }, { value: "staff", label: "Staff", count: 20 }];
function Panels() {
  return <><WorkspaceTabPanel value="tasks">Task records</WorkspaceTabPanel><WorkspaceTabPanel value="staff">Staff records</WorkspaceTabPanel></>;
}
describe("WorkspaceTabs", () => {
  it("names the list and panels, associates IDs and displays counts including zero", () => {
    render(<WorkspaceTabs label="Today" value="tasks" tabs={tabs} onChange={() => {}}><Panels /></WorkspaceTabs>);
    expect(screen.getByRole("tablist", { name: "Today" })).toBeVisible();
    const task = screen.getByRole("tab", { name: "Tasks 0", selected: true });
    expect(within(task).getByText("0")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Staff 20", selected: false })).toBeVisible();
    const panel = screen.getByRole("tabpanel", { name: "Tasks 0" });
    expect(task).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", task.id);
    expect(screen.queryByText("Staff records")).not.toBeInTheDocument();
  });
  it("reports clicks but leaves selection controlled by the caller", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorkspaceTabs label="Today" value="tasks" tabs={tabs} onChange={onChange}><Panels /></WorkspaceTabs>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Staff 20" }), { button: 0, ctrlKey: false });
    expect(onChange).toHaveBeenCalledWith("staff");
    expect(screen.getByRole("tab", { name: "Tasks 0" })).toHaveAttribute("aria-selected", "true");
    rerender(<WorkspaceTabs label="Today" value="staff" tabs={tabs} onChange={onChange}><Panels /></WorkspaceTabs>);
    expect(screen.getByRole("tabpanel", { name: "Staff 20" })).toHaveTextContent("Staff records");
  });
  it.each(["en", "ur"] as const)("supports mirrored arrow navigation, wrapping and Home/End in %s", async language => {
    function Controlled() {
      const [value, setValue] = useState("tasks");
      return <Language language={language}><WorkspaceTabs label="Today" value={value} tabs={tabs} onChange={setValue}><Panels /></WorkspaceTabs></Language>;
    }
    render(<Controlled />);
    const task = screen.getByRole("tab", { name: `${translate("Tasks", language)} 0` });
    const staff = screen.getByRole("tab", { name: `${translate("Staff", language)} 20` });
    task.focus();
    const forward = language === "ur" ? "ArrowLeft" : "ArrowRight";
    fireEvent.keyDown(task, { key: forward });
    await waitFor(() => expect(staff).toHaveFocus());
    expect(staff).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: translate("Reviewed", language) })).toBeDisabled();
    fireEvent.keyDown(staff, { key: forward });
    await waitFor(() => expect(task).toHaveFocus());
    fireEvent.keyDown(task, { key: "End" });
    await waitFor(() => expect(staff).toHaveFocus());
    fireEvent.keyDown(staff, { key: "Home" });
    await waitFor(() => expect(task).toHaveFocus());
  });
  it.each(["Enter", " "])("can activate a tab with %s", key => {
    const onChange = vi.fn();
    render(<WorkspaceTabs label="Today" value="tasks" tabs={tabs} onChange={onChange}><Panels /></WorkspaceTabs>);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Staff 20" }), { key });
    expect(onChange).toHaveBeenCalledWith("staff");
  });
  it("keeps disabled options and a disabled list inert", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorkspaceTabs label="Today" value="tasks" tabs={tabs} onChange={onChange}><Panels /></WorkspaceTabs>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Reviewed" }), { button: 0 });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<WorkspaceTabs label="Today" value="tasks" tabs={tabs} onChange={onChange} disabled><Panels /></WorkspaceTabs>);
    for (const tab of screen.getAllByRole("tab")) expect(tab).toBeDisabled();
  });
  it("can omit counts and render an empty controlled list without inventing content", () => {
    const { rerender } = render(<WorkspaceTabs label="Today" value="tasks" tabs={[{ value: "tasks", label: "Tasks" }]} onChange={() => {}}><Panels /></WorkspaceTabs>);
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeVisible();
    rerender(<WorkspaceTabs label="Today" value="" tabs={[]} onChange={() => {}}>{null}</WorkspaceTabs>);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });
});
