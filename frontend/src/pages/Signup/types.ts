export type SignUpForm = {
  name: string;
  email: string;
  password: string;
  companyName: string;
};



export type UserRole = 'ADMIN' | 'MANAGER' | 'STAFF';


export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  companyId: number;
  sessionEstablished?: boolean;
}
