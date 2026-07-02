type RuntimeEnvironment = Record<string, string | undefined>;

/** Validate names only in errors: environment values can contain credentials. */
export function validateRuntimeSecurity(env: RuntimeEnvironment): void {
  if (env.NODE_ENV !== "production") return;
  const invalid = new Set<string>();
  const secretNames = ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"] as const;
  for (const name of secretNames) {
    const value = env[name] ?? "";
    if (Buffer.byteLength(value, "utf8") < 32 || value !== value.trim() ||
        /replace[_ -]?me|change[_ -]?me|placeholder|your[_ -]?(?:jwt|secret)|example/i.test(value) ||
        new Set(value).size < 8) invalid.add(name);
  }
  if (env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) {
    secretNames.forEach(name => invalid.add(name));
  }
  for (const name of ["ACCESS_TOKEN_EXPIRY", "REFRESH_TOKEN_EXPIRY", "STAFF_REFRESH_TOKEN_EXPIRY"]) {
    // Explicit units avoid jsonwebtoken treating a bare string number as ms.
    if (!/^[1-9]\d{0,8}(?:ms|s|m|h|d|w|y)$/.test(env[name] ?? "")) invalid.add(name);
  }
  const origins = (env.FRONTEND_URL ?? "").split(",").map(value => value.trim());
  if (!origins.length || origins.some(origin => {
    try {
      const url = new URL(origin);
      return url.protocol !== "https:" || !!url.username || !!url.password ||
        url.origin !== origin || url.hostname.includes("*") || url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    } catch { return true; }
  })) invalid.add("FRONTEND_URL");
  if (!["true", "1", "yes", "on"].includes((env.COOKIE_SECURE ?? "").trim().toLowerCase())) {
    invalid.add("COOKIE_SECURE");
  }
  if (!["lax", "strict", "none"].includes((env.COOKIE_SAME_SITE ?? "lax").trim().toLowerCase())) {
    invalid.add("COOKIE_SAME_SITE");
  }
  if (invalid.size) {
    throw new Error(`Unsafe production configuration: ${[...invalid].join(", ")}. Configure explicit secure values before starting.`);
  }
}
