
export type LoginForm={
  email: string;
  password: string;
}


export type UserRole = 'ADMIN' | 'MANAGER' | 'STAFF';


export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  companyId: number;
}
