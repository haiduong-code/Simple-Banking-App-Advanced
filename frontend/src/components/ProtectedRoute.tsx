import type { JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import type { UserRole } from '../types/users';

// Chan truy cap khi chua dang nhap -> chuyen ve /login
export default function ProtectedRoute({
  children,
  role,
}: {
  children: JSX.Element;
  role?: UserRole;
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (role && user?.role !== role) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
