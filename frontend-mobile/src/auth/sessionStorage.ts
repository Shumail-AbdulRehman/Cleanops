// AsyncStorage's legacy key contains characters that SecureStore rejects.
export const SECURE_SESSION_KEY = 'cleanops-staff.auth';

type LegacyStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export function createSessionStorage(native: boolean, legacyKey: string, legacy: LegacyStorage, secure: SecureStorage) {
  return {
    async read(): Promise<string | null> {
      if (!native) return legacy.getItem(legacyKey);
      return (await secure.getItemAsync(SECURE_SESSION_KEY)) ?? legacy.getItem(legacyKey);
    },
    async write(value: string | null): Promise<void> {
      if (!native) {
        if (value === null) await legacy.removeItem(legacyKey);
        else await legacy.setItem(legacyKey, value);
        return;
      }
      if (value === null) await secure.deleteItemAsync(SECURE_SESSION_KEY);
      else await secure.setItemAsync(SECURE_SESSION_KEY, value);
      // Keep legacy recovery data until secure persistence has succeeded.
      await legacy.removeItem(legacyKey);
    },
  };
}
