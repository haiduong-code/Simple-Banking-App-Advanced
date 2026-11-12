import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyUserHistory, updateMe } from '../api/users';
import BankingLayout from '../components/BankingLayout';
import { formatDateTime, formatJson } from '../lib/format';
import { getErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth';
import type { UpdateMePayload } from '../types/users';

const PAGE_SIZE = 8;

const actionLabels: Record<string, string> = {
  update_profile: 'Cập nhật hồ sơ',
  status_change: 'Đổi trạng thái',
  soft_delete: 'Xóa mềm',
};

function getActionLabel(action: string): string {
  return actionLabels[action] ?? action;
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [page, setPage] = useState(1);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [formMessage, setFormMessage] = useState<string | null>(null);

  useEffect(() => {
    setFullName(user?.fullName ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
  }, [user?.email, user?.fullName, user?.phone]);

  const historyQuery = useQuery({
    queryKey: ['user-history', { page }],
    queryFn: () => getMyUserHistory({ page, limit: PAGE_SIZE }),
    placeholderData: (previousData) => previousData,
  });

  const mutation = useMutation({
    mutationFn: (payload: UpdateMePayload) => updateMe(payload),
    onSuccess: async (data) => {
      updateUser(data);
      setFormMessage('Đã cập nhật hồ sơ');
      await queryClient.invalidateQueries({ queryKey: ['user-history'] });
    },
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormMessage(null);

    const payload: UpdateMePayload = {};
    const nextFullName = fullName.trim();
    const nextEmail = email.trim().toLowerCase();

    if (nextFullName && nextFullName !== user?.fullName) {
      payload.fullName = nextFullName;
    }
    if (nextEmail && nextEmail !== user?.email) {
      payload.email = nextEmail;
    }
    if (phone !== (user?.phone ?? '')) payload.phone = phone;
    if (!payload.fullName && !payload.email && payload.phone === undefined) {
      setFormMessage('Không có thay đổi mới');
      return;
    }

    mutation.mutate(payload);
  };

  const totalPages = historyQuery.data?.meta.totalPages ?? 0;

  return (
    <BankingLayout
      title="Hồ sơ và lịch sử thay đổi"
      subtitle="Cập nhật thông tin cá nhân và kiểm tra các phiên bản đã ghi nhận."
    >
      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="border-b border-slate-100 pb-5">
            <h2 className="font-semibold text-slate-900">Thông tin hồ sơ</h2>
            <p className="mt-1 text-sm text-slate-500">
              Mọi thay đổi sẽ được ghi lại trong history.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Số điện thoại
              <input
                aria-label="Số điện thoại"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                pattern="(\+?[0-9]{9,15})?"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Họ tên
              </label>
              <input
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value.slice(0, 100));
                  setFormMessage(null);
                  mutation.reset();
                }}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value.slice(0, 255));
                  setFormMessage(null);
                  mutation.reset();
                }}
                type="email"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
            </div>
          </div>

          {mutation.isError && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {getErrorMessage(mutation.error, 'Không thể cập nhật hồ sơ')}
            </div>
          )}

          {formMessage && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              {formMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="mt-6 w-full rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>

          {user && (
            <dl className="mt-6 space-y-4 border-t border-slate-100 pt-5 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Vai trò
                </dt>
                <dd className="mt-1 font-semibold capitalize text-slate-800">
                  {user.role}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Trạng thái
                </dt>
                <dd
                  className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                    user.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {user.status === 'active' ? 'Đang hoạt động' : 'Đã khóa'}
                </dd>
              </div>
            </dl>
          )}
        </form>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="font-semibold text-slate-900">History hồ sơ</h2>
              <p className="mt-1 text-sm text-slate-500">
                {historyQuery.data
                  ? `${historyQuery.data.meta.total} bản ghi`
                  : 'Đang tải dữ liệu'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => historyQuery.refetch()}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Làm mới
            </button>
          </div>

          {historyQuery.isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-24 animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          ) : historyQuery.isError ? (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold text-slate-800">
                Không tải được history hồ sơ
              </p>
            </div>
          ) : historyQuery.data?.items.length ? (
            <>
              <div className="divide-y divide-slate-100">
                {historyQuery.data.items.map((item) => (
                  <article key={item.id} className="px-6 py-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {getActionLabel(item.action)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {item.changedById ? 'Có actor' : 'System'}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                          Before
                        </summary>
                        <pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-600">
                          {formatJson(item.beforeData)}
                        </pre>
                      </details>
                      <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                          After
                        </summary>
                        <pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-600">
                          {formatJson(item.afterData)}
                        </pre>
                      </details>
                    </div>
                  </article>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
                <p className="text-sm text-slate-500">
                  Trang {historyQuery.data.meta.page} /{' '}
                  {Math.max(totalPages, 1)}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1 || historyQuery.isFetching}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Trang trước
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages || historyQuery.isFetching}
                    onClick={() => setPage((current) => current + 1)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Trang sau
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold text-slate-800">Chưa có history</p>
              <p className="mt-1 text-sm text-slate-500">
                Bản ghi đầu tiên sẽ xuất hiện sau khi hồ sơ được cập nhật.
              </p>
            </div>
          )}
        </section>
      </div>
    </BankingLayout>
  );
}
