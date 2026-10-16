import assert from "node:assert/strict";
import test from "node:test";
import { launchUrdu } from "../launch/launchTranslations.ts";
import { staffAppUrdu } from "./staffAppTranslations.ts";
import { translate, translateText, urdu } from "./translations.ts";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

test("staffAppUrdu has no key shared with urdu or launchUrdu", () => {
  for (const key of Object.keys(staffAppUrdu)) {
    assert.ok(!(key in urdu), `${key} is in urdu`);
    assert.ok(!(key in launchUrdu), `${key} is in launchUrdu`);
  }
});

test("every value is Urdu script and keeps placeholders", () => {
  for (const [key, value] of Object.entries(staffAppUrdu)) {
    assert.ok(value.trim().length > 0, key);
    assert.match(value, /[؀-ۿ]/, key);
    assert.deepEqual(placeholders(value), placeholders(key), key);
  }
});

test("lookup order and fallback", () => {
  assert.equal(translate("See my history", "ur"), staffAppUrdu["See my history"]);
  assert.equal(translateText("See my history", "ur"), staffAppUrdu["See my history"]);
  assert.equal(translate("Check in", "ur"), urdu["Check in"] ?? launchUrdu["Check in"]);
  assert.equal(translate("Totally unknown phrase", "ur"), "Totally unknown phrase");
  assert.equal(translate("See my history", "en"), "See my history");
});

test("day-off and work-day keys have Urdu translations", () => {
  for (const key of [
    "Day off today", "Your next shift is {day} at {time}.", "Ask your manager if you should be working today.",
    "tomorrow", "Work days", "Every day", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ]) {
    assert.match(translate(key, "ur"), /[؀-ۿ]/, key);
  }
});

test("required extra strings exist", () => {
  for (const k of ["Uploaded, checking", "Connection settings", "Server address", "Change server address", "Save address", "Hide connection settings", "Show connection settings", "Restart scanner", "Torch on", "Torch off", "Refresh results", "Results updated"]) {
    assert.notEqual(translate(k, "ur"), k, k);
  }
});

test("Part 2 history and profile strings are translated", () => {
  for (const k of ["No finished tasks this month.", "This task is not in your history.", "Manager", "No shifts yet", "No tasks yet", "No manager assigned", "Not set", "Figures could not load.", "On shift", "No shifts this month.", "Upcoming", "Sunday"]) {
    assert.notEqual(translate(k, "ur"), k, k);
  }
});

test("phone sign-in and recovery strings are translated", () => {
  const keys = [
    "Staff sign in",
    "Phone number",
    "Send code",
    "Enter your phone number.",
    "Enter the 6-digit code we sent to {phone}.",
    "6-digit code",
    "Sign in",
    "Enter the 6-digit code.",
    "Change number",
    "Send a new code",
    "You can ask for a new code in {seconds} seconds.",
    "Enter a Pakistan mobile number, like 03001234567.",
    "This number is not registered. Ask your manager to add you.",
    "Wait {seconds} seconds before asking for a new code.",
    "This number has reached today's code limit. Try again tomorrow or ask your manager.",
    "Sign-in codes are used up for today. Ask your manager.",
    "The code could not be sent. Try again in a few minutes.",
    "Too many attempts. Try again later.",
    "That code is not right. {n} tries left.",
    "This code has expired. Ask for a new code.",
    "Too many wrong tries. Ask for a new code.",
    "Update the Hygene Ops app to sign in with your phone number.",
    "Unable to sign in.",
    "Unable to sign in.\n\nServer: {address}\nCheck that your phone and server are on the same network, or change the server address below.",
    "You will need your phone number and a new code to sign in again.",
    "I did not get the code",
    "Wait one minute and tap Send a new code. If it still does not come, ask your manager to check your phone number.",
    "Ask your manager about your shift, task QR or your phone number.",
    "Sign in again",
    "Your sign-in has changed. Sign out, then sign in with your phone number and a new code.",
    "No email",
  ];
  for (const key of keys) assert.notEqual(translate(key, "ur"), key, key);
});
