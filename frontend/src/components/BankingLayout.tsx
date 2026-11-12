import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import api, { getErrorMessage } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

interface BankingLayoutProps {
  children: ReactNode;
  title: string;
  subtitle: string;
}

const baseNavigation = [
  { to: '/dashboard', label: 'Tổng quan' },
  { to: '/transfer', label: 'Chuyển khoản' },
  { to: '/cash', label: 'Nạp / rút tiền' },
  { to: '/transactions', label: 'Lịch sử giao dịch' },
  { to: '/profile', label: 'Hồ sơ' },
  { to: '/security', label: 'Bảo mật' },
];

export default function BankingLayout({
  children,
  title,
  subtitle,
}: BankingLayoutProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const navigation =
    user?.role === 'admin'
      ? [
          ...baseNavigation,
          { to: '/admin/module-3', label: 'Quản trị' },
          { to: '/admin/operations', label: 'Duyệt & đối soát' },
        ]
      : baseNavigation;

  const onLogout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await api.post('/auth/logout');
    } catch (error) {
      setLogoutError(
        getErrorMessage(error, 'Không thể đăng xuất. Vui lòng thử lại.'),
      );
      setLoggingOut(false);
      return;
    }
    logout();
    queryClient.clear();
    navigate('/login');
  };

  const initials =
    user?.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-3 text-left"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-lg font-bold text-white shadow-sm">
              S
            </span>
            <span>
              <span className="block text-base font-bold text-slate-900">
                Simple Banking
              </span>
              <span className="block text-xs text-slate-500">
                Ngân hàng trực tuyến
              </span>
            </span>
          </button>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-800">
                {user?.fullName}
              </p>
              <p className="text-xs text-slate-500">{user?.email}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
              {initials}
            </span>
            <button
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {logoutError && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {logoutError}
          </p>
        )}
        <div className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
