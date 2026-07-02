import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../prisma/migrations/202611210001_work_days/migration.sql', import.meta.url),
  'utf8',
);
const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const sqlWeekdays = weekdays.map((day) => `'${day}'`).join(', ');
const fields = [
  ['Staff', 'workDays'],
  ['TaskTemplate', 'repeatDays'],
] as const;

describe('work days schema and migration', () => {
  it('declares exactly the seven weekdays in order', () => {
    const enumBody = schema.match(/^enum Weekday\s*\{([^}]*)\}/m)?.[1];
    expect(enumBody?.trim().split(/\s+/)).toEqual(weekdays);
  });

  it.each(fields)('defaults %s.%s to all seven weekdays in the schema', (model, field) => {
    const modelBody = schema.match(new RegExp(`^model ${model}\\s*\\{([^}]*)\\}`, 'm'))?.[1];
    const declaration = modelBody?.match(new RegExp(`^\\s*${field}\\s+([^\\r\\n]+)$`, 'm'))?.[1];
    expect(declaration?.trim().replace(/\s+/g, ' ')).toBe(`Weekday[] @default([${weekdays.join(', ')}])`);
  });

  it('only creates the weekday enum and adds the two non-null columns with all-seven defaults', () => {
    const statements = migration
      .replace(/^\s*--[^\r\n]*/gm, '')
      .split(';')
      .map((statement) => statement.trim().replace(/\s+/g, ' '))
      .filter(Boolean);

    expect(statements).toEqual([
      `CREATE TYPE "Weekday" AS ENUM (${sqlWeekdays})`,
      ...fields.map(([table, column]) =>
        `ALTER TABLE "${table}" ADD COLUMN "${column}" "Weekday"[] NOT NULL DEFAULT ARRAY[${sqlWeekdays}]::"Weekday"[]`,
      ),
    ]);
  });

  it('contains no UPDATE, DELETE, DROP or TRUNCATE statements', () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  });
});
