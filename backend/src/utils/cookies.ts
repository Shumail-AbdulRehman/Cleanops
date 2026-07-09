type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "strict" | "lax" | "none";
  path: string;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const parseSameSite = (value: string | undefined): CookieOptions["sameSite"] => {
  if (!value) {
    return "lax";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "none" || normalized === "strict" || normalized === "lax") {
    return normalized;
  }

  return "lax";
};

export const getCookieOptions = (withSameSite = true): CookieOptions => {
  const secure = parseBoolean(process.env.COOKIE_SECURE, false);
  const sameSite = parseSameSite(process.env.COOKIE_SAME_SITE);

  return {
    httpOnly: true,
    secure,
    path: "/",
    ...(withSameSite ? { sameSite } : {}),
  };
};

export const getCookieRuntimeConfig = () => ({
  secure: parseBoolean(process.env.COOKIE_SECURE, false),
  sameSite: parseSameSite(process.env.COOKIE_SAME_SITE),
});
