// Spec 67: styles that react-native-web accepts but the Android build ignores or drops.
// The web build and the node harness both passed while the phone showed broken rows, so this
// scans the source instead of a render.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');

function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    // Components (.tsx) and the style token modules; data and query modules hold no styles.
    const styled = /\.tsx$/.test(name) || (/\.ts$/.test(name) && /[\\/](design|src)$/.test(dir));
    return styled && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Drops comments so explanations may name the forbidden patterns. */
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const WEB_ONLY = [
  ['display other than flex or none', /\bdisplay:\s*['"](?!flex['"]|none['"])[^'"]*['"]/],
  ['logical inline/block spacing', /\b(padding|margin)(Inline|Block)(Start|End)?\s*:/],
  ['inset shorthand', /\binset(Inline|Block)?(Start|End)?\s*:/],
  ['fixed or sticky position', /\bposition:\s*['"](fixed|sticky)['"]/],
  ['CSS-only property', /\b(cursor|transition\w*|whiteSpace|textWrap|wordBreak|overflowWrap|gridTemplate\w*|gridArea|visibility|backdropFilter|float|textOverflow|WebkitLineClamp)\s*:/],
  ['CSS unit or calc() in a style value', /\b(width|height|(min|max)(Width|Height)|padding\w*|margin\w*|top|left|right|bottom|start|end|gap|rowGap|columnGap|fontSize|lineHeight|letterSpacing|border\w*(Radius|Width)|flexBasis)\s*:\s*['"][^'"]*(\d(px|rem|em|vh|vw)\b|calc\()/],
  ['textAlign start or end', /\btextAlign:\s*['"](start|end)['"]/],
  ['percentage gap', /\b(gap|rowGap|columnGap):\s*['"][\d.]+%['"]/],
];

/** A `style={(...) => ...}` callback: NativeWind's native interop spreads it into `{}`. */
const STYLE_CALLBACK = /\bstyle=\{\s*(\(\s*\{?[^)]*\}?\s*\)|\w+)\s*=>/;

test('no source file gives a Pressable (or anything) a style callback', () => {
  const hits = [];
  for (const file of sources(src)) {
    code(readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      if (STYLE_CALLBACK.test(line)) hits.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('no web-only style property appears in src', () => {
  const hits = [];
  for (const file of sources(src)) {
    code(readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      for (const [name, pattern] of WEB_ONLY) {
        if (pattern.test(line)) hits.push(`${relative(root, file)}:${index + 1} (${name}): ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(hits, []);
});

test('the scan patterns catch what they name', () => {
  assert.ok(STYLE_CALLBACK.test("style={({ pressed }) => [styles.row]}"));
  assert.ok(STYLE_CALLBACK.test('style={state => [a]}'));
  assert.ok(!STYLE_CALLBACK.test('style={[styles.row, pressed ? a : null]}'));
  const caught = sample => WEB_ONLY.some(([, pattern]) => pattern.test(sample));
  for (const sample of ["display: 'contents'", "display: 'grid'", 'paddingInline: 16', 'marginInlineStart: 4', 'inset: 0',
    "position: 'sticky'", "cursor: 'pointer'", "whiteSpace: 'nowrap'", "width: '12px'", "height: 'calc(100% - 4px)'",
    "textAlign: 'start'", "gap: '5%'"]) {
    assert.ok(caught(sample), sample);
  }
  for (const sample of ["display: 'none'", "display: 'flex'", 'paddingHorizontal: 16', "width: '100%'", "textAlign: 'right'", 'gap: 12', "left: '50%'"]) {
    assert.ok(!caught(sample), sample);
  }
});
