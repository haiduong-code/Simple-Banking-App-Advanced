import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { getMyAccount } from '../api/accounts';
import BankingLayout from '../components/BankingLayout';
import { formatMoney } from '../lib/money';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  // Gọi API lấy dữ liệu thẻ ngân hàng (Số dư)
  const {
    data: account,
    isLoading: accountLoading,
    isError: accountError,
  } = useQuery({
    queryKey: ['my-account'],
    queryFn: getMyAccount,
  });

  return (
    <BankingLayout
      title={`Xin chào, ${user?.fullName || 'bạn'}`}
      subtitle="Tổng quan tài khoản và các thao tác ngân hàng của bạn."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 p-7 text-white shadow-lg">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-100">
                  Tài khoản thanh toán
                </p>
                <p className="mt-1 text-sm text-emerald-50">Simple Banking</p>
              </div>
              <span className="rounded-lg bg-white/15 px-3 py-1 text-xs font-semibold">
                {account?.currency || 'VND'}
              </span>
            </div>

            {accountLoading ? (
              <div className="mt-8 h-24 animate-pulse rounded-xl bg-white/15" />
            ) : accountError ? (
              <p className="mt-8 text-sm text-red-100">
                Không tải được thông tin tài khoản.
              </p>
            ) : account ? (
              <div className="mt-8">
                <p className="font-mono text-2xl font-semibold tracking-[0.18em]">
                  {account.accountNumber}
                </p>
                <div className="mt-7 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-emerald-100">
                      Số dư khả dụng
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      {formatMoney(account.balance)}{' '}
                      <span className="text-lg font-semibold">{account.currency}</span>
                    </p>
                  </div>
                  <p className="text-right text-sm font-semibold uppercase tracking-wider text-emerald-50">
                    {user?.fullName}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              to="/transfer"
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-xl font-bold text-emerald-700">
                ↑
              </span>
              <h2 className="mt-4 font-semibold text-slate-900">Chuyển khoản</h2>
              <p className="mt-1 text-sm text-slate-500">
                Chuyển tiền tới tài khoản nội bộ an toàn và tức thời.
              </p>
              <p className="mt-4 text-sm font-semibold text-emerald-700 group-hover:text-emerald-800">
                Thực hiện giao dịch →
              </p>
            </Link>

            <Link
              to="/transactions"
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-100 text-xl font-bold text-sky-700">
                ↔
              </span>
              <h2 className="mt-4 font-semibold text-slate-900">Lịch sử giao dịch</h2>
              <p className="mt-1 text-sm text-slate-500">
                Kiểm tra các khoản tiền vào, tiền ra và trạng thái.
              </p>
              <p className="mt-4 text-sm font-semibold text-emerald-700 group-hover:text-emerald-800">
                Xem lịch sử →
              </p>
            </Link>
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Thông tin hồ sơ</h2>
          <p className="mt-1 text-sm text-slate-500">Thông tin chủ tài khoản hiện tại.</p>

          {user && (
            <dl className="mt-6 space-y-5 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Họ tên
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">{user.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Email
                </dt>
                <dd className="mt-1 break-all font-semibold text-slate-800">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Vai trò
                </dt>
                <dd className="mt-1 font-semibold capitalize text-slate-800">{user.role}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Trạng thái
                </dt>
                <dd className="mt-1 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  Đang hoạt động
                </dd>
              </div>
            </dl>
          )}
        </aside>
      </div>
    </BankingLayout>
  );
}
