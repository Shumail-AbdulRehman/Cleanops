import { prisma } from "../prisma/prisma.js";
import { managerLoginSchema } from "../validations/manager.validation.js";
import { ApiError } from "../utils/ApiError.js";
import { generateAccessToken, generateRefreshToken, isPasswordCorrect } from "../utils/auth.js";

type LoginAccount = {
  id: number;
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "MANAGER" | "STAFF";
  companyId: number;
  credentialVersion: number;
  isActive: boolean;
};

type LoginModel = {
  findUnique(args: { where: { email: string } }): Promise<LoginAccount | null>;
  findMany(args: { where: { email: { equals: string; mode: "insensitive" } }; take: number }): Promise<LoginAccount[]>;
  update(args: { where: { id: number }; data: { refreshToken: string } }): Promise<unknown>;
};
type LoginDb = { manager: LoginModel };

const loginSchema = managerLoginSchema.strict();
// Valid cost-10 bcrypt hash, matching the existing password hashing cost. Never
// authenticate against it: it only supplies comparison work for missing users.
const DUMMY_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const invalidCredentials = () => new ApiError(401, "Invalid email or password");

async function findAccount(model: LoginModel, email: string) {
  const exact = await model.findUnique({ where: { email } });
  if (exact) return exact;
  const matches = await model.findMany({ where: { email: { equals: email, mode: "insensitive" } }, take: 2 });
  return matches.length === 1 ? matches[0]! : null;
}

export async function login(input: unknown, db: LoginDb = prisma) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, "Validation failed", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  }
  const { email, password } = parsed.data;
  const account = await findAccount(db.manager, email);
  if (!account || account.role === "STAFF") {
    await isPasswordCorrect(password, DUMMY_PASSWORD_HASH);
    throw invalidCredentials();
  }
  if (!await isPasswordCorrect(password, account.password)) throw invalidCredentials();
  if (!account.isActive) throw new ApiError(403, "Account is deactivated", [{ code: "ACCOUNT_DEACTIVATED" }]);

  const accessToken = generateAccessToken(account, account.role);
  const refreshToken = generateRefreshToken(account, account.role);
  await db.manager.update({ where: { id: account.id }, data: { refreshToken } });
  const user = { id: account.id, name: account.name, email: account.email, role: account.role, companyId: account.companyId };
  return { accessToken, refreshToken, user };
}
