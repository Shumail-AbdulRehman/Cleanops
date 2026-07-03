import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

const cronFiles = [
  "taskStatusCron.ts",
  "taskReassignmentCron.ts",
  "staffNotificationCron.ts",
  "onceTaskScheduler.ts",
  "deletedMediaCron.ts",
  "attendanceStatusCron.ts",
  "attendanceCron.ts",
];

it.each(cronFiles)("%s guards every scheduled job against overlaps", (file) => {
  const sourceText = readFileSync(new URL(file, import.meta.url), "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest);
  const schedules: ts.CallExpression[] = [];

  function collectSchedules(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression, name } = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "cron" && name.text === "schedule") {
        schedules.push(node);
      }
    }
    ts.forEachChild(node, collectSchedules);
  }

  collectSchedules(source);
  expect(schedules.length).toBeGreaterThan(0);

  for (const schedule of schedules) {
    const options = schedule.arguments[2];
    const hasOverlapGuard = options && ts.isObjectLiteralExpression(options) &&
      options.properties.some((property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "noOverlap" &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword,
      );
    const { line } = source.getLineAndCharacterOfPosition(schedule.getStart(source));
    expect(hasOverlapGuard, `${file}:${line + 1}`).toBe(true);
  }
});
