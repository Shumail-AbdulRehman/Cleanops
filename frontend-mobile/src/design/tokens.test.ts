import { test } from "node:test";
import assert from "node:assert/strict";
import { colors, contrast, gutterFor, isNarrow, motion, radius, space, tokens } from "./tokens";

// Transcribed independently from DESIGN-SYSTEM.md#colour.
const expectedColors: Record<string, string> = {
  ink: "#141c30",
  muted: "#55617a",
  subtle: "#98a4b8",
  offDay: "#667389",
  future: "#b5bfd0",
  pillText: "#3b475e",
  line: "#e3e8f0",
  lineStrong: "#cbd4e2",
  canvas: "#f2f5fb",
  segmentTrack: "#e4e9f3",
  surface: "#ffffff",
  soft: "#f7f9fc",
  blue: "#2556d8",
  blueDeep: "#1a3ba3",
  blueWash: "#eaf0ff",
  onBlue: "#dbe5ff",
  onDarkSoft: "#e9edf5",
  onCamera: "#d6deed",
  bannerSoft: "#c9d3e6",
  yellow: "#ffd21f",
  yellowPress: "#f0c000",
  yellowWash: "#fff6d0",
  yellowInk: "#5a4300",
  ok: "#16613d",
  okWash: "#e4f4ea",
  bad: "#a32128",
  badDeep: "#7f1a20",
  badWash: "#fdeeed",
  warn: "#7b4200",
  warnWash: "#fff1dc",
  late: "#f08a3c",
  night: "#0e1526",
  night2: "#1a2439",
  tintBg: "#dfe8fc",
  tintFg: "#4f77d6",
  scrim: "#0e152680",
  cameraButton: "#ffffff24",
};

test("every colour token in DESIGN-SYSTEM.md is present with the same value, and nothing else", () => {
  assert.deepEqual({ ...colors }, expectedColors);
  for (const value of Object.values(colors)) {
    assert.match(value, /^#([0-9a-f]{6}|[0-9a-f]{8})$/);
  }
});

test("every contrast pair in DESIGN-SYSTEM.md#colour is at least 4.5:1", () => {
  const pairs: Array<[keyof typeof colors, keyof typeof colors]> = [
    ["ink", "surface"],
    ["muted", "surface"],
    ["blueDeep", "blueWash"],
    ["ok", "okWash"],
    ["bad", "badWash"],
    ["warn", "warnWash"],
    ["yellowInk", "yellowWash"],
    ["surface", "blue"], // white on blue
    ["ink", "yellow"],
    ["ink", "late"],
    ["onBlue", "blue"],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(colors[fg], colors[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
});

test("contrast() is the WCAG ratio and rejects non 6-digit colours", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#2556d8", "#2556d8"), 1);
  assert.throws(() => contrast("#fff", "#000000"));
  assert.throws(() => contrast(colors.scrim, colors.surface));
});

test("late is never the action yellow", () => {
  assert.notEqual(colors.late, colors.yellow);
  assert.notEqual(colors.late, colors.yellowPress);
});

// DESIGN-SYSTEM.md#type sets these Manrope display roles smaller in Urdu (Noto Arabic reads larger
// at the same size) while giving them taller lines. DESIGN-SYSTEM.md wins over the spec's
// "Urdu size at least English" wording; see spec 02's Log.
const urduSmallerDisplayRoles = new Set([
  "nowTitle",
  "nowTitleCompact",
  "nowTitleLong",
  "pageTitle",
  "headline",
  "moment",
]);

test("every type role has en and ur; Urdu is at least as large as English except the listed display roles, and never shorter", () => {
  const roles = Object.keys(tokens.type);
  assert.equal(roles.length, 20);
  for (const role of roles) {
    const { en, ur } = tokens.type[role as keyof typeof tokens.type];
    assert.ok(en && ur, `${role} has en and ur`);
    for (const variant of [en, ur]) {
      assert.ok(variant.size > 0 && variant.lineHeight >= variant.size, `${role} sizes`);
      assert.ok(
        ["body", "bodySemi", "bodyBold", "bodyExtra", "title", "titleBold", "urdu", "urduBold"].includes(variant.family),
        `${role} family is a role key`,
      );
    }
    assert.ok(ur.lineHeight >= en.lineHeight, `${role}: Urdu line height ${ur.lineHeight} >= ${en.lineHeight}`);
    if (urduSmallerDisplayRoles.has(role)) {
      assert.ok(ur.size < en.size, `${role} is a known Urdu-smaller display role`);
    } else {
      assert.ok(ur.size >= en.size, `${role}: Urdu size ${ur.size} >= ${en.size}`);
    }
  }
});

test("type roles carry the design's compact, narrow and line limits", () => {
  const { nowTitle, nowTitleCompact, nowTitleLong, calendarHead, action, badge, input } = tokens.type;
  assert.deepEqual(nowTitleLong.en.compact, { size: 23, lineHeight: 27 });
  assert.deepEqual(nowTitleLong.ur.compact, { size: 23, lineHeight: 33 });
  assert.equal(nowTitleLong.maxLines, 3);
  assert.equal(nowTitleLong.en.size, 27);
  assert.deepEqual(nowTitle.en.compact, { size: nowTitleCompact.en.size, lineHeight: nowTitleCompact.en.lineHeight });
  assert.deepEqual(nowTitle.ur.compact, { size: nowTitleCompact.ur.size, lineHeight: nowTitleCompact.ur.lineHeight });
  assert.deepEqual(calendarHead.ur.narrow, { size: 13, lineHeight: 18 });
  assert.equal(action.ur.family, "urduBold");
  assert.equal(action.en.family, "title");
  assert.equal(badge.en.size, 13);
  assert.equal(input.ur.family, "body");
});

test("gutter and narrow rules", () => {
  assert.equal(gutterFor(360), 16);
  assert.equal(gutterFor(390), 20);
  assert.equal(isNarrow(374), true);
  assert.equal(isNarrow(375), false);
  assert.equal(space.narrowWidth, 375);
});

test("layout, radius and motion values match DESIGN-SYSTEM.md", () => {
  assert.equal(space.rowMinHeight, 76);
  assert.equal(space.rowMinHeightCompact, 64);
  assert.equal(space.markerSize, 34);
  assert.equal(space.actionHeight, 64);
  assert.equal(space.touchMin, 44);
  assert.equal(space.touchMinIcon, 48);
  assert.equal(radius.actionRadius, 18);
  assert.equal(radius.chipRadius, 22);
  assert.equal(radius.sheetRadius, 26);
  assert.equal(radius.workSheetRadius, 28);
  assert.deepEqual({ ...motion.duration }, {
    press: 120, nowChange: 220, sheet: 280, scrim: 200, dialog: 180, snack: 200, busy: 180,
    scanLine: 1900, locateRing: 1500, badge: 340, tickDraw: 300, tickDelay: 120, reducedFade: 120,
  });
  assert.deepEqual([...motion.easing.easeOut], [0.23, 1, 0.32, 1]);
  assert.deepEqual([...motion.easing.drawer], [0.32, 0.72, 0, 1]);
  assert.equal(motion.scale.press, 0.97);
  assert.equal(motion.scale.shutter, 0.93);
});

test("tokens are frozen", () => {
  assert.ok(Object.isFrozen(colors));
  assert.ok(Object.isFrozen(tokens.type.body.en));
  assert.ok(Object.isFrozen(motion.easing.easeOut));
  assert.ok(Object.isFrozen(space));
  assert.ok(Object.isFrozen(radius));
});
