/// <reference types="node" />
// vitest.config.ts discovers only .test.tsx. Run this required .test.ts with:
// node --experimental-strip-types --test src/components/layout/workspaceTokens.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sourceRoot = new URL('../../', import.meta.url);
const css = readFileSync(new URL('workspace-tokens.css', sourceRoot), 'utf8');
const design = readFileSync(new URL('../../specs-workspace-redesign/DESIGN-SYSTEM.md', sourceRoot), 'utf8');
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
// This stylesheet deliberately has only flat rules: tokens and opt-in helpers.
const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
const rules = Array.from(withoutComments.matchAll(rulePattern), ([, selector, content]) => ({
  selector: selector.trim(),
  declarations: Array.from(content.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g), ([, name, value]) => ({
    name,
    value: value.trim(),
  })),
}));
const declarations = rules.flatMap(rule => rule.declarations.map(declaration => ({
  ...declaration,
  selector: rule.selector,
})));

function expectToken(name: string, value: string) {
  const matches = declarations.filter(declaration => declaration.name === name);
  assert.equal(matches.length, 1, `${name} must be defined exactly once`);
  assert.equal(matches[0].selector, '.workspace', `${name} must be scoped to .workspace`);
  assert.equal(matches[0].value, value, `${name} must match DESIGN-SYSTEM.md`);
}

function documentedColours() {
  const tokens: Record<string, string> = {};
  const colourSection = design.split('## Colour tokens')[1].split('## Typography')[0];
  const rows = colourSection.split('\n').filter(line => line.startsWith('| `--wx-'));
  assert.ok(rows.length > 0, 'must read the design-system colour tables');
  for (const row of rows) {
    const [, nameCell, valueCell, foregroundCell] = row.split('|');
    const names = Array.from(nameCell.matchAll(/`(--wx-[\w-]+)`/g), match => match[1]);
    const colours = Array.from(valueCell.matchAll(/`(#[\da-f]{6})`/gi), match => match[1]);
    assert.ok(names.length > 0, `token name missing in ${row}`);
    if (/^--wx-tint-\d+$/.test(names[0])) {
      tokens[`${names[0]}-bg`] = colours[0];
      const foreground = foregroundCell.match(/`(#[\da-f]{6})`/i);
      assert.ok(foreground, `foreground missing in ${row}`);
      tokens[`${names[0]}-fg`] = foreground[1];
    } else {
      assert.equal(colours.length, names.length, `one value per token in ${row}`);
      names.forEach((name, index) => { tokens[name] = colours[index]; });
    }
  }
  return tokens;
}

test('every documented colour and avatar pair is present exactly once with its approved value', () => {
  for (const [name, value] of Object.entries(documentedColours())) expectToken(name, value);
});

// The design document names these roles in prose rather than prescribing CSS names.
const roleTokens = {
  'font-body': '"Inter Variable", sans-serif',
  'font-heading': '"Manrope Variable", sans-serif',
  'font-urdu': '"Noto Sans Arabic", Tahoma, sans-serif',
  numerals: 'tabular-nums',
  'page-title-size': '28px',
  'page-title-leading': '1.15',
  'page-title-weight': '800',
  'page-title-tracking': '-0.03em',
  'subtitle-size': '15px',
  'subtitle-weight': '400',
  'panel-title-size': '17px',
  'panel-title-leading': '1.3',
  'panel-title-weight': '750',
  'figure-size-min': '32px',
  'figure-size-max': '34px',
  'figure-leading': '1.1',
  'figure-weight': '800',
  'body-size': '14.5px',
  'body-leading': '1.5',
  'body-weight': '400',
  'label-size': '14px',
  'label-weight': '600',
  'small-size-min': '12.5px',
  'small-size-max': '13.5px',
  'small-weight-min': '400',
  'small-weight-max': '600',
  'nav-heading-size': '14px',
  'nav-heading-size-compact': '13px',
  'nav-heading-weight': '700',
  'nav-link-size': '15.5px',
  'nav-link-size-compact': '14.5px',
  'radius-sm': '6px',
  'radius-md': '8px',
  'radius-lg': '12px',
  'radius-pill': '999px',
  'page-padding-block': '28px',
  'page-padding-inline': '32px',
  'page-padding-block-phone': '20px',
  'page-padding-inline-phone': '16px',
  'page-max-width': '1400px',
  'rail-width': '256px',
  'panel-padding-block': '20px',
  'panel-padding-inline': '22px',
  'panel-gap': '16px',
  'panel-border-width': '1px',
  'panel-shadow': 'none',
  'button-height': '40px',
  'touch-target-min': '40px',
  'pill-size': '12.5px',
  'pill-weight': '600',
  'table-header-size': '12.5px',
  'table-cell-padding': '13px',
  'nav-link-height': '47px',
  'nav-link-height-compact': '40px',
  'nav-icon-size': '20px',
  'nav-icon-size-compact': '18px',
  'nav-link-gap': '2px',
  'tab-underline-width': '2px',
  'chip-height': '34px',
  'segment-inset': '3px',
  'side-panel-width': '440px',
  'side-panel-width-wide': '560px',
  'field-height': '42px',
  'avatar-size': '36px',
  'avatar-size-sm': '26px',
  'avatar-size-lg': '64px',
  'site-avatar-radius': '10px',
  'press-scale': '0.97',
  'duration-press': '120ms',
  'duration-panel': '280ms',
  'duration-panel-reduced': '120ms',
  'duration-scrim': '200ms',
  'duration-inline-panel': '180ms',
  'duration-tooltip': '80ms',
  'duration-phone-rail': '220ms',
  'duration-feedback': '150ms',
  'duration-none': '0ms',
  'ease-out': 'cubic-bezier(.23, 1, .32, 1)',
  'ease-panel': 'cubic-bezier(.32, .72, 0, 1)',
  'ease-feedback': 'ease',
  'ease-tooltip': 'linear',
};

test('documented typography, radii, spacing, component dimensions and motion exist once', () => {
  for (const [role, value] of Object.entries(roleTokens)) expectToken(`--wx-${role}`, value);
});

test('the closed token set uses the wx namespace, occurs once and belongs to .workspace', () => {
  const customProperties = declarations.filter(({ name }) => name.startsWith('--'));
  assert.deepEqual(customProperties.map(({ name }) => name).sort(), [
    ...Object.keys(documentedColours()),
    ...Object.keys(roleTokens).map(role => `--wx-${role}`),
  ].sort(), 'only documented tokens may be defined, each exactly once');
  for (const { name, value } of customProperties) {
    assert.match(name, /^--wx-/, 'legacy shadcn variables must not be redefined');
    expectToken(name, value);
  }
});

test('all stylesheet rules are scoped and only the two opt-in helpers add styles', () => {
  assert.equal(withoutComments.replace(rulePattern, '').trim(), '', 'all CSS must parse as flat rules');
  assert.deepEqual(rules.map(({ selector }) => selector), [
    '.workspace',
    '.workspace .wx-page-title',
    '.workspace .wx-page-title:lang(ur)',
    '.workspace .wx-tabular-nums',
  ]);
  assert.doesNotMatch(rules.map(({ selector }) => selector).join('\n'), /:root|\bbody\b/);
  assert.doesNotMatch(withoutComments, /@import|@font-face/);
  assert.ok(rules[0].declarations.every(({ name }) => name.startsWith('--wx-')),
    'the workspace rule must not change any styles yet');
});

test('page-title and numeral helpers consume tokens, with an Urdu font override', () => {
  const properties = (selector: string) => Object.fromEntries(
    rules.find(rule => rule.selector === selector)!.declarations.map(({ name, value }) => [name, value]),
  );
  assert.deepEqual(properties('.workspace .wx-page-title'), {
    'font-family': 'var(--wx-font-heading)',
    'font-size': 'var(--wx-page-title-size)',
    'font-weight': 'var(--wx-page-title-weight)',
    'line-height': 'var(--wx-page-title-leading)',
    'letter-spacing': 'var(--wx-page-title-tracking)',
    'font-variant-numeric': 'var(--wx-numerals)',
  });
  assert.deepEqual(properties('.workspace .wx-page-title:lang(ur)'), {
    'font-family': 'var(--wx-font-urdu)',
    'line-height': 'normal',
    'letter-spacing': 'normal',
  });
  assert.deepEqual(properties('.workspace .wx-tabular-nums'), {
    'font-variant-numeric': 'var(--wx-numerals)',
  });
});

test('every helper token reference resolves inside the workspace token set', () => {
  for (const [, name] of css.matchAll(/var\((--[\w-]+)\)/g)) {
    assert.ok(declarations.some(declaration => declaration.name === name), `${name} must resolve`);
  }
});

