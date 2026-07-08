import { describe, expect, it } from "vitest";
import { assertCredentialSession } from "./credentialSession.service.js";
describe("credential epoch access boundary", () => {
  it("permits only the exact current principal credential version", () => {
    expect(() => assertCredentialSession({ credentialVersion: 3 }, { credentialVersion: 3 })).not.toThrow();
    expect(() => assertCredentialSession({ credentialVersion: 3 }, { credentialVersion: 2 })).toThrow("Access Token Expired");
  });
  it("treats typed pre-epoch tokens as version0 rather than upgrading them to current", () => {
    expect(() => assertCredentialSession({ credentialVersion: 0 }, {})).not.toThrow();
    expect(() => assertCredentialSession({ credentialVersion: 1 }, {})).toThrow();
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects invalid version %j even if principal and token match", value => {
    expect(() => assertCredentialSession({ credentialVersion: value }, { credentialVersion: value })).toThrow();
  });
  it("rejects operational/refresh access until required password replacement", () => {
    expect(() => assertCredentialSession({ credentialVersion: 1, mustChangePassword: true }, { credentialVersion: 1 })).toThrow("Replace your password");
    expect(() => assertCredentialSession({ credentialVersion: 1, mustChangePassword: true }, { credentialVersion: 1 }, true)).not.toThrow();
    expect(() => assertCredentialSession({ credentialVersion: 1, mustChangePassword: true }, { credentialVersion: 0 }, true)).toThrow("Access Token Expired");
  });
});
