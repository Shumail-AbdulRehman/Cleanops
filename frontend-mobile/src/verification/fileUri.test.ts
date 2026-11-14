import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseDirectoryUri } from './fileUri';

test('Android SQLite paths become file URIs; iOS URIs keep their exact directory', () => {
  assert.equal(databaseDirectoryUri('/data/user/0/com.hygeneops.staff/files/SQLite'), 'file:///data/user/0/com.hygeneops.staff/files/SQLite');
  assert.equal(databaseDirectoryUri('/private/room #1/SQLite'), 'file:///private/room%20%231/SQLite');
  const ios='file:///var/mobile/Containers/Data/Application/abc/Library/SQLite';
  assert.equal(databaseDirectoryUri(ios), ios);
  assert.throws(() => databaseDirectoryUri('SQLite'), /unavailable/);
});
