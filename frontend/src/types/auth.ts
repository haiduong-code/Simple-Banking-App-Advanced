export interface SafeUser {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  role: 'customer' | 'teller' | 'admin';
  status: 'active' | 'locked';
  createdAt: string;
  deletedAt?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
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
