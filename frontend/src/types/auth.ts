export interface SafeUser {
  id: string;
  fullName: string;
  email: string;
  role: 'customer' | 'admin';
  status: 'active' | 'locked';
  createdAt: string;
  deletedAt?: string | null;
}

export interface AuthResult {
  accessToken: string;
  user: SafeUser;
}

export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

// User rut gon tra ve tu GET /auth/me (route bao ve)
export interface MeResult {
  userId: string;
  email: string;
  role: string;
}
