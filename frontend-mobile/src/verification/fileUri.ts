/** SQLite returns a plain path on Android and a file URI on iOS. FileSystem needs a URI. */
export function databaseDirectoryUri(directory: string): string {
  if (directory.startsWith('file:///')) return directory;
  if (!directory.startsWith('/')) throw new Error('The saved-photo database directory is unavailable.');
  return `file://${directory.split('/').map(encodeURIComponent).join('/')}`;
}
