#!/usr/bin/env python3
"""Exercise connection-scoped encryption using the pinned Expo SQLCipher library.

Pass --library to a locally compiled vendor/sqlcipher/sqlite3.c shared library.
Uses only a temporary fixture; never opens phone or application databases.
"""
import argparse
import ctypes
import json
import secrets
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--library', required=True)
    args = parser.parse_args()
    lib = ctypes.CDLL(str(Path(args.library).resolve()))
    # Expo prefixes its vendored SQLite symbols to avoid platform collisions.
    for name in ['open', 'close', 'exec', 'errmsg', 'free']:
        setattr(lib, 'sqlite3_' + name, getattr(lib, 'exsqlite3_' + name))
    lib.sqlite3_open.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
    lib.sqlite3_close.argtypes = [ctypes.c_void_p]
    lib.sqlite3_exec.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p,
                                ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    lib.sqlite3_errmsg.argtypes = [ctypes.c_void_p]
    lib.sqlite3_errmsg.restype = ctypes.c_char_p
    lib.sqlite3_free.argtypes = [ctypes.c_void_p]
    callback_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_int,
                                    ctypes.POINTER(ctypes.c_char_p),
                                    ctypes.POINTER(ctypes.c_char_p))

    class Connection:
        def __init__(self, path):
            self.handle = ctypes.c_void_p()
            assert lib.sqlite3_open(str(path).encode(), ctypes.byref(self.handle)) == 0

        def execute(self, sql):
            rows = []

            @callback_type
            def collect(_context, count, values, names):
                rows.append({names[i].decode(): values[i].decode() if values[i] else None
                             for i in range(count)})
                return 0

            error = ctypes.c_void_p()
            code = lib.sqlite3_exec(self.handle, sql.encode(), ctypes.cast(collect, ctypes.c_void_p),
                                    None, ctypes.byref(error))
            if error.value:
                lib.sqlite3_free(error)
            if code:
                raise RuntimeError(f'{code}: {lib.sqlite3_errmsg(self.handle).decode()}')
            return rows

        def close(self):
            assert lib.sqlite3_close(self.handle) == 0

    with tempfile.TemporaryDirectory(prefix='hygene-sqlcipher-') as directory:
        path = Path(directory) / 'verification.db'
        key_sql = f'PRAGMA key = "x\'{secrets.token_hex(32)}\'";'
        primary = Connection(path)
        primary.execute(key_sql)
        version = primary.execute('PRAGMA cipher_version;')[0]['cipher_version']
        assert version
        primary.execute('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; '
                        'PRAGMA secure_delete=ON; CREATE TABLE queue(id TEXT PRIMARY KEY, photo BLOB); '
                        "INSERT INTO queue VALUES('retained',x'040506');")
        # Expo's exclusive transaction opens an unkeyed connection to this file.
        exclusive = Connection(path)
        try:
            exclusive.execute('BEGIN;')
            try:
                exclusive.execute('SELECT count(*) FROM queue;')
            except RuntimeError as error:
                assert 'file is not a database' in str(error)
            else:
                raise AssertionError('An unkeyed connection read encrypted evidence')
            exclusive.execute('ROLLBACK;')
        finally:
            exclusive.close()
        # Queue serialization allows the transaction on the original keyed handle.
        primary.execute("BEGIN; INSERT INTO queue VALUES('new',x'070809'); COMMIT;")
        primary.execute("BEGIN; INSERT INTO queue VALUES('rollback',x'ff');")
        try:
            primary.execute("INSERT INTO queue VALUES('retained',x'00');")
        except RuntimeError:
            primary.execute('ROLLBACK;')
        else:
            raise AssertionError('Fixture uniqueness failure did not occur')
        assert primary.execute('SELECT id,hex(photo) AS bytes FROM queue ORDER BY id;') == [
            {'id': 'new', 'bytes': '070809'}, {'id': 'retained', 'bytes': '040506'}]
        primary.close()
        assert not path.read_bytes().startswith(b'SQLite format 3')
        reopened = Connection(path)
        try:
            reopened.execute(key_sql)
            assert reopened.execute('SELECT count(*) AS count FROM queue;') == [{'count': '2'}]
        finally:
            reopened.close()
        print(json.dumps({'sqlCipherVersion': version, 'unkeyedConnectionReproducedError': True,
                          'keyedCaptureTransactionPassed': True, 'rollbackPreservedEvidence': True,
                          'encryptedHeaderVerified': True, 'reopenPreservedEvidence': True,
                          'physicalDeviceTest': False}))


if __name__ == '__main__':
    main()
