import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { test } from "node:test";
import { translate } from "./translations.ts";
import { workspaceRedesignUrdu } from "./workspaceRedesignTranslations.ts";

const placeholders = (text: string) =>
  [...text.matchAll(/\{[^{}]+\}/g)].map(([token]) => token).sort();

// Discover every existing web dictionary, including additions to the lookup chain.
const existingDictionaries: Record<string, string>[] = [];
for (const filename of await readdir(new URL("./", import.meta.url))) {
  if (!/Translations\.ts$/.test(filename) || filename === "workspaceRedesignTranslations.ts") continue;
  const module = await import(new URL(filename, import.meta.url).href);
  for (const [name, value] of Object.entries(module)) {
    if (/Urdu$/.test(name)) existingDictionaries.push(value as Record<string, string>);
  }
}
const { urdu } = await import("./translations.ts");
existingDictionaries.push(urdu);

for (const [key, value] of Object.entries(workspaceRedesignUrdu)) {
  test(`workspace Urdu: ${key}`, () => {
    assert.equal(key, key.trim());
    assert.ok(value.trim().length > 0);
    assert.match(value, /\p{Script=Arabic}/u);
    assert.deepEqual(placeholders(value), placeholders(key));
    assert.equal(translate(key, "ur"), value);
    assert.equal(translate(key, "en"), key);
    for (const brand of ["Paddle", "Hygene Ops", "Excel", ".xlsx"]) {
      assert.equal(value.split(brand).length, key.split(brand).length);
    }
  });
}

test("workspace keys never duplicate any existing web dictionary", () => {
  assert.ok(Object.keys(workspaceRedesignUrdu).length > 0);
  for (const dictionary of existingDictionaries) {
    for (const key of Object.keys(dictionary)) {
      assert.equal(Object.hasOwn(workspaceRedesignUrdu, key), false, key);
    }
  }
});

test("all existing Urdu lookups win even if the new dictionary acquires a collision", () => {
  const existingKeys = new Set(existingDictionaries.flatMap(dictionary => Object.keys(dictionary)));
  for (const key of existingKeys) {
    const expected = translate(key, "ur");
    workspaceRedesignUrdu[key] = "عارضی ترجمہ";
    try {
      assert.equal(translate(key, "ur"), expected, key);
    } finally {
      delete workspaceRedesignUrdu[key];
    }
  }
});

test("required redesign copy and side-panel actions resolve through the shared lookup", () => {
  const required = [
    "Work through the day", "Tasks due so far", "compared with tasks submitted.",
    "Tasks due so far, compared with tasks submitted.", "Due by this time", "tasks behind",
    "Now", "Later today", "View hourly figures", "By location", "Lowest progress first.",
    "Welcome, {name}", "Your company is ready. Four steps take you to the first working shift.",
    "What this page becomes", "Step {step} of 4.", "Open full checklist", "Needs attention today",
    "staff checked in", "Staff access", "Choose a category", "Nothing is waiting for you",
    "See reviewed", "This page could not load", "Previous month", "Next month", "Yesterday",
    "Earlier work", "All dates", "Overview", "Attendance", "Photo Reviews", "Company setup",
    "Add location", "Edit location", "Save changes", "Cancel", "Close", "Use my position",
    "Add team member", "Edit team member", "Save access change", "Close and clear code",
    "Import staff", "Download Excel template", "Choose Excel file", "Confirm import",
    "Add manager", "Edit manager", "Add area template", "Add fixtures", "Archive template",
    "Confirm archive", "Add cleaning schedule", "Save note", "Save decision", "Close photo",
    "Search for a place", "More actions for {name}", "View daily records: {name}",
    "Floor", "Worktop", "Show the whole basin and the tap.", "Tasks submitted", "Time",
    "Open", "Print", "Check", "Ready", "Not checked out yet", "{plan} plan",
    "Every day, {time}, {name}", "Every day, {start} and {end}", "Morning washroom clean",
    "{name}: still shows residue", "{name} photo is too far away to check",
    "No photo received for {name}", "Photos were sent after the photo deadline",
    "Room inventory needs setup before photos can be reviewed", "{name}: smudges in first photo",
  ];
  for (const key of required) {
    assert.match(translate(key, "ur"), /\p{Script=Arabic}/u, key);
    assert.deepEqual(placeholders(translate(key, "ur")), placeholders(key), key);
  }
  assert.equal(translate("Needs attention today", "ur"), "آج توجہ درکار ہے");
  assert.equal(translate("Choose a category", "ur"), "قسم منتخب کریں");
  assert.equal(translate("Work through the day", "ur"), "دن بھر کے کام کی پیش رفت");
});

test("interpolation preserves a supplied name and direction-isolation markers", () => {
  const name = "\u2068Ayesha Khan\u2069";
  assert.equal(translate("Welcome, {name}", "ur", { name }), `خوش آمدید، ${name}`);
  assert.equal(translate("Welcome, {name}", "en", { name }), `Welcome, ${name}`);
});

test("submitted, verified and review closed remain separate statuses", () => {
  const statuses = ["Submitted", "Verified", "Review closed"].map(key => translate(key, "ur"));
  for (const status of statuses) assert.match(status, /\p{Script=Arabic}/u);
  assert.equal(new Set(statuses).size, 3);
  assert.notEqual(translate("Due by this time", "ur"), translate("Work submitted", "ur"));
});

test("new finding and schedule templates interpolate user data without changing it", () => {
  const name = "\u2068Custom sink 2\u2069";
  assert.equal(translate("No photo received for {name}", "ur", { name }), `${name} کی کوئی تصویر موصول نہیں ہوئی`);
  assert.equal(translate("Every day, {start} and {end}", "ur", { start: "09:30", end: "15:00" }), "ہر روز، 09:30 اور 15:00");
  assert.equal(translate("{plan} plan", "ur", { plan: "Pro" }), "Pro پلان");
});

for (const count of [0, 1, 20]) {
  test(`interpolation preserves count ${count} and a missing total`, () => {
    const key = "{count} of {total} staff checked in";
    assert.equal(translate(key, "ur", { count, total: 20 }), `عملے کے 20 میں سے ${count} افراد نے حاضری لگا دی`);
    assert.equal(translate(key, "ur", { count }), `عملے کے {total} میں سے ${count} افراد نے حاضری لگا دی`);
  });
}

test("unregistered copy keeps the existing English fallback and interpolation", () => {
  assert.equal(translate("Unregistered workspace copy for {name}", "ur", { name: "Ayesha" }), "Unregistered workspace copy for Ayesha");
});
