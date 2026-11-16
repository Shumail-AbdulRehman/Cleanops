import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
installMocks({ '/i18n/LanguageProvider': { useLanguage } });
const { StyleSheet } = await import('react-native');
const { AttendanceCalendar } = await import('../../src/screens/history/AttendanceCalendar.tsx');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
// Measured in the web export (spec 58 Log): widest Urdu name 51.16 at 14.5; minimum label width 58.
const MIN_WIDTH = 58;
const URDU = ['پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ', 'اتوار'];

const draw = async width => {
  setWindowSize(width, 800);
  const r = await render(h(AttendanceCalendar, { month: '2026-11', records: [], todayYmd: '2026-11-07', width }));
  const rowsOf = r.root.findAll(n => n.type === 'View' && styleOf(n).gap === 3 && n.children.length === 7 && styleOf(n).flexDirection);
  const head = rowsOf[0];
  const dayRow = rowsOf[1];
  return { r, head, dayRow, cell: styleOf(head.children[0]).width };
};
const labelAreas = head => head.children.map(column => column.children[0]);

test.beforeEach(() => setLanguage('en'));
test.afterEach(() => { setLanguage('en'); setWindowSize(390, 844); });

for (const width of [320, 360, 375, 390, 412]) {
  test(`Urdu at ${width}: every name area is wide enough, centred on its column, and the row keeps its width`, async () => {
    setLanguage('ur');
    const { head, dayRow, cell } = await draw(width);
    assert.equal(styleOf(head).flexDirection, 'row-reverse');
    const areas = labelAreas(head);
    assert.equal(areas.length, 7);
    areas.forEach((area, index) => {
      const s = styleOf(area);
      assert.ok(s.width >= MIN_WIDTH, `${width}: area ${index} width ${s.width}`);
      // Left and right offsets around the column are equal, so centres coincide.
      const centre = s.marginHorizontal + s.width / 2;
      assert.ok(Math.abs(centre - cell / 2) <= 0.5, `${width}: area ${index} centre`);
      const text = area.children[0];
      assert.equal(text.props.numberOfLines, 1);
    });
    const laidOut = row => row.children.reduce((sum, column) => sum + styleOf(column).width, 0);
    assert.equal(laidOut(head), laidOut(dayRow));
    assert.equal(styleOf(head).gap, styleOf(dayRow).gap);
    const names = head.findAll(n => n.type === 'Text').map(n => n.children.join(''));
    assert.deepEqual(names, URDU);
  });
}

test('English at 390: names render at 14 and sit over the day columns', async () => {
  const { r, head, dayRow, cell } = await draw(390);
  const names = r.root.findAll(n => n.type === 'Text' && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(n.children.join('')));
  assert.equal(names.length, 7);
  assert.ok(names.every(n => styleOf(n).fontSize === 14));
  head.children.forEach((column, i) => assert.equal(styleOf(column).width, styleOf(dayRow.children[i]).width));
  assert.equal(cell, Math.floor((390 - 16 - 18) / 7));
});
