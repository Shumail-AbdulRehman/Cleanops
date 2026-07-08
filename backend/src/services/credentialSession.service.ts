import { ApiError } from "../utils/ApiError.js";

/** A missing version on a previously typed JWT means the migration's initial0,
 * never the current account version. Password reset cannot upgrade an old JWT. */
export function assertCredentialSession(
  principal: { credentialVersion?: number; mustChangePassword?: boolean },
  token: { credentialVersion?: number },
  allowPasswordReplacement = false,
) {
  const current = principal.credentialVersion ?? 0;
  const issued = token.credentialVersion === undefined ? 0 : token.credentialVersion;
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(issued) || issued < 0 || current !== issued)
    throw new ApiError(401, "Access Token Expired", [{ code: "SESSION_REVOKED" }]);
  if (principal.mustChangePassword && !allowPasswordReplacement)
    throw new ApiError(403, "Replace your password before continuing", [{ code: "PASSWORD_CHANGE_REQUIRED" }]);
}
