import assert from 'node:assert/strict';
import test from 'node:test';
import { urdu, translate } from '../src/i18n/translations.ts';
import { urdu as nativeUrdu } from '../../frontend-mobile/src/i18n/translations.ts';
test('web and staff app share essential instructions and Urdu vocabulary', () => {
 assert.deepEqual(urdu,nativeUrdu);
 for(const text of ['Check in','Submit work','Photo saved on this phone','Photo uploading','Photo received and being checked','Waiting for manager review','Internet needed to continue','Show the entire basin, drain and tap.'])assert.notEqual(translate(text,'ur'),text);
 assert.equal(translate('Hello, {name}','ur',{name:'Ayesha'}).includes('Ayesha'),true);
});
