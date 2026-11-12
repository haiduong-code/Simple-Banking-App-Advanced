import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAdminTransactions,
  getAdminUsers,
  softDeleteAdminAccount,
  softDeleteAdminUser,
  updateAdminUserStatus,
} from '../api/admin';
import { getAuditLogs } from '../api/audit';
import { getAccountHistory } from '../api/accounts';
import { reverseTransaction } from '../api/transactions';
import BankingLayout from '../components/BankingLayout';
import { getErrorMessage } from '../lib/api';
import { compactId, formatDateTime, formatJson } from '../lib/format';
import { formatMoney } from '../lib/money';
import type { AdminTransaction, AdminUser } from '../types/admin';
import type { TransactionStatus, TransactionType } from '../types/transactions';
import type { UserRole, UserStatus } from '../types/users';

const PAGE_SIZE = 8;

type AdminTab = 'users' | 'transactions' | 'audit' | 'account-history';

const tabs: Array<{ value: AdminTab; label: string }> = [
  { value: 'users', label: 'User & Account' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'audit', label: 'Audit Log' },
  { value: 'account-history', label: 'Account History' },
];

const transactionStatusLabels: Record<TransactionStatus, string> = {
  initiated: 'Đã khởi tạo',
  pending_otp: 'Chờ OTP',
  pending_approval: 'Chờ admin duyệt',
  processing: 'Đang xử lý',
  pending: 'Đang xử lý',
  completed: 'Hoàn tất',
  failed: 'Thất bại',
  reversed: 'Đã hoàn',
};

const transactionTypeLabels: Record<TransactionType, string> = {
  withdrawal: 'Rút tiền',
  transfer: 'Transfer',
  deposit: 'Deposit',
  reversal: 'Reversal',
  opening_balance: 'Opening balance',
};

const userStatusLabels: Record<UserStatus, string> = {
  active: 'Đang hoạt động',
  locked: 'Đã khóa',
};

function statusBadge(status: TransactionStatus) {
  const className =
    status === 'completed'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'pending'
        ? 'bg-amber-50 text-amber-700'
        : status === 'reversed'
          ? 'bg-slate-100 text-slate-600'
          : 'bg-red-50 text-red-700';

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {transactionStatusLabels[status]}
    </span>
  );
}

function userStatusBadge(status: UserStatus) {
  const className =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-700';

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {userStatusLabels[status]}
    </span>
  );
}

function canReverse(transaction: AdminTransaction): boolean {
  return (
    transaction.type === 'transfer' &&
    transaction.status === 'completed' &&
    !transaction.reversalTransactionId
  );
}

export default function AdminModule3Page() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('users');
  const [usersPage, setUsersPage] = useState(1);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [accountHistoryPage, setAccountHistoryPage] = useState(1);
  const [search, setSearch] = useState('');
  const [userStatus, setUserStatus] = useState<UserStatus | ''>('');
  const [userRole, setUserRole] = useState<UserRole | ''>('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<
    TransactionStatus | ''
  >('');
  const [transactionType, setTransactionType] = useState<TransactionType | ''>(
    '',
  );
  const [accountIdFilter, setAccountIdFilter] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditEntity, setAuditEntity] = useState('');
  const [historyAccountId, setHistoryAccountId] = useState('');
  const [reverseTarget, setReverseTarget] = useState<AdminTransaction | null>(
    null,
  );
  const [reverseReason, setReverseReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const userParams = useMemo(
    () => ({
      page: usersPage,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      status: userStatus || undefined,
      role: userRole || undefined,
      includeDeleted,
    }),
    [includeDeleted, search, userRole, userStatus, usersPage],
  );

  const usersQuery = useQuery({
    queryKey: ['admin-users', userParams],
    queryFn: () => getAdminUsers(userParams),
    placeholderData: (previousData) => previousData,
    enabled: tab === 'users',
  });

  const transactionParams = useMemo(
    () => ({
      page: transactionsPage,
      limit: PAGE_SIZE,
      status: transactionStatus || undefined,
      type: transactionType || undefined,
      accountId: accountIdFilter.trim() || undefined,
    }),
    [accountIdFilter, transactionStatus, transactionType, transactionsPage],
  );

  const transactionsQuery = useQuery({
    queryKey: ['admin-transactions', transactionParams],
    queryFn: () => getAdminTransactions(transactionParams),
    placeholderData: (previousData) => previousData,
    enabled: tab === 'transactions',
  });

  const auditParams = useMemo(
    () => ({
      page: auditPage,
      limit: PAGE_SIZE,
      action: auditAction.trim() || undefined,
      entity: auditEntity.trim() || undefined,
    }),
    [auditAction, auditEntity, auditPage],
  );

  const auditQuery = useQuery({
    queryKey: ['audit-logs', auditParams],
    queryFn: () => getAuditLogs(auditParams),
    placeholderData: (previousData) => previousData,
    enabled: tab === 'audit',
  });

  const accountHistoryQuery = useQuery({
    queryKey: [
      'account-history',
      { accountId: historyAccountId.trim(), page: accountHistoryPage },
    ],
    queryFn: () =>
      getAccountHistory(historyAccountId.trim(), {
        page: accountHistoryPage,
        limit: PAGE_SIZE,
      }),
    placeholderData: (previousData) => previousData,
    enabled: tab === 'account-history' && historyAccountId.trim().length > 0,
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: UserStatus }) =>
      updateAdminUserStatus(userId, status),
    onSuccess: async () => {
      setFeedback('Đã cập nhật trạng thái user');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs'] }),
      ]);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: softDeleteAdminUser,
    onSuccess: async () => {
      setFeedback('Đã soft delete user');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs'] }),
      ]);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: softDeleteAdminAccount,
    onSuccess: async () => {
      setFeedback('Đã soft delete account');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['account-history'] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs'] }),
      ]);
    },
  });

  const reverseMutation = useMutation({
    mutationFn: ({
      transactionId,
      reason,
    }: {
      transactionId: string;
      reason: string;
    }) => reverseTransaction(transactionId, { reason }),
    onSuccess: async () => {
      setFeedback('Đã tạo reversal và đánh dấu giao dịch gốc đã hoàn');
      setReverseTarget(null);
      setReverseReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['my-account'] }),
      ]);
    },
  });

  const userTotalPages = usersQuery.data?.meta.totalPages ?? 0;
  const transactionTotalPages = transactionsQuery.data?.meta.totalPages ?? 0;
  const auditTotalPages = auditQuery.data?.meta.totalPages ?? 0;
  const accountHistoryTotalPages =
    accountHistoryQuery.data?.meta.totalPages ?? 0;

  const activeMutationError =
    statusMutation.error ||
    deleteUserMutation.error ||
    deleteAccountMutation.error ||
    reverseMutation.error;

  return (
    <BankingLayout
      title="Admin Module 3"
      subtitle="Kiểm tra audit trail, soft delete, transaction state machine và versioning."
    >
      <div className="space-y-6">
        <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setTab(item.value);
                setFeedback(null);
              }}
              className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                tab === item.value
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {activeMutationError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getErrorMessage(activeMutationError, 'Thao tác không thành công')}
          </div>
        )}

        {feedback && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {feedback}
          </div>
        )}

        {tab === 'users' && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_160px_150px_160px]">
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setUsersPage(1);
                }}
                placeholder="Tìm theo email hoặc họ tên"
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
              <select
                value={userStatus}
                onChange={(event) => {
                  setUserStatus(event.target.value as UserStatus | '');
                  setUsersPage(1);
                }}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              >
                <option value="">Mọi status</option>
                <option value="active">Active</option>
                <option value="locked">Locked</option>
              </select>
              <select
                value={userRole}
                onChange={(event) => {
                  setUserRole(event.target.value as UserRole | '');
                  setUsersPage(1);
                }}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              >
                <option value="">Mọi role</option>
                <option value="customer">Customer</option>
                <option value="admin">Admin</option>
              </select>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(event) => {
                    setIncludeDeleted(event.target.checked);
                    setUsersPage(1);
                  }}
                  className="h-4 w-4 accent-emerald-600"
                />
                Kể cả đã xóa
              </label>
            </div>

            {usersQuery.isLoading ? (
              <LoadingRows />
            ) : usersQuery.isError ? (
              <EmptyState title="Không tải được danh sách user" />
            ) : usersQuery.data?.items.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-6 py-3 font-semibold">User</th>
                        <th className="px-6 py-3 font-semibold">Role</th>
                        <th className="px-6 py-3 font-semibold">Status</th>
                        <th className="px-6 py-3 font-semibold">Accounts</th>
                        <th className="px-6 py-3 text-right font-semibold">
                          Thao tác
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {usersQuery.data.items.map((item) => (
                        <UserRow
                          key={item.id}
                          user={item}
                          busy={
                            statusMutation.isPending ||
                            deleteUserMutation.isPending ||
                            deleteAccountMutation.isPending
                          }
                          onToggleStatus={() => {
                            setFeedback(null);
                            statusMutation.mutate({
                              userId: item.id,
                              status:
                                item.status === 'active' ? 'locked' : 'active',
                            });
                          }}
                          onDeleteUser={() => {
                            setFeedback(null);
                            deleteUserMutation.mutate(item.id);
                          }}
                          onDeleteAccount={(accountId) => {
                            setFeedback(null);
                            deleteAccountMutation.mutate(accountId);
                          }}
                          onPickAccountHistory={(accountId) => {
                            setHistoryAccountId(accountId);
                            setAccountHistoryPage(1);
                            setTab('account-history');
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={usersQuery.data.meta.page}
                  totalPages={userTotalPages}
                  disabled={usersQuery.isFetching}
                  onPrevious={() =>
                    setUsersPage((current) => Math.max(1, current - 1))
                  }
                  onNext={() => setUsersPage((current) => current + 1)}
                />
              </>
            ) : (
              <EmptyState title="Không có user phù hợp" />
            )}
          </section>
        )}

        {tab === 'transactions' && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 px-6 py-5 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
              <select
                value={transactionStatus}
                onChange={(event) => {
                  setTransactionStatus(
                    event.target.value as TransactionStatus | '',
                  );
                  setTransactionsPage(1);
                }}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              >
                <option value="">Mọi status</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="reversed">Reversed</option>
              </select>
              <select
                value={transactionType}
                onChange={(event) => {
                  setTransactionType(
                    event.target.value as TransactionType | '',
                  );
                  setTransactionsPage(1);
                }}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              >
                <option value="">Mọi type</option>
                <option value="transfer">Transfer</option>
                <option value="reversal">Reversal</option>
                <option value="deposit">Deposit</option>
                <option value="opening_balance">Opening balance</option>
              </select>
              <input
                value={accountIdFilter}
                onChange={(event) => {
                  setAccountIdFilter(event.target.value);
                  setTransactionsPage(1);
                }}
                placeholder="Lọc theo accountId"
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
            </div>

            {transactionsQuery.isLoading ? (
              <LoadingRows />
            ) : transactionsQuery.isError ? (
              <EmptyState title="Không tải được giao dịch" />
            ) : transactionsQuery.data?.items.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] text-left">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-6 py-3 font-semibold">Thời gian</th>
                        <th className="px-6 py-3 font-semibold">Luồng tiền</th>
                        <th className="px-6 py-3 font-semibold">Type</th>
                        <th className="px-6 py-3 text-right font-semibold">
                          Số tiền
                        </th>
                        <th className="px-6 py-3 text-center font-semibold">
                          Status
                        </th>
                        <th className="px-6 py-3 text-right font-semibold">
                          Thao tác
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactionsQuery.data.items.map((item) => (
                        <tr
                          key={item.id}
                          className="transition hover:bg-slate-50/70"
                        >
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                            <p>{formatDateTime(item.createdAt)}</p>
                            <p className="mt-1 font-mono text-xs text-slate-400">
                              {compactId(item.id)}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-mono text-sm text-slate-700">
                              {item.fromAccountNumber ?? '-'} →{' '}
                              {item.toAccountNumber ?? '-'}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {item.description || 'Không có nội dung'}
                            </p>
                          </td>
                          <td className="px-6 py-4 text-sm font-semibold text-slate-700">
                            {transactionTypeLabels[item.type]}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-bold text-slate-900">
                            {formatMoney(item.amount)} VND
                          </td>
                          <td className="px-6 py-4 text-center">
                            {statusBadge(item.status)}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {canReverse(item) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setReverseTarget(item);
                                  setReverseReason('');
                                  setFeedback(null);
                                }}
                                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
                              >
                                Reversal
                              </button>
                            ) : (
                              <span className="text-sm text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={transactionsQuery.data.meta.page}
                  totalPages={transactionTotalPages}
                  disabled={transactionsQuery.isFetching}
                  onPrevious={() =>
                    setTransactionsPage((current) => Math.max(1, current - 1))
                  }
                  onNext={() => setTransactionsPage((current) => current + 1)}
                />
              </>
            ) : (
              <EmptyState title="Không có giao dịch phù hợp" />
            )}
          </section>
        )}

        {tab === 'audit' && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 px-6 py-5 md:grid-cols-2">
              <input
                value={auditAction}
                onChange={(event) => {
                  setAuditAction(event.target.value);
                  setAuditPage(1);
                }}
                placeholder="Lọc action, ví dụ transaction.reversal.completed"
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
              <input
                value={auditEntity}
                onChange={(event) => {
                  setAuditEntity(event.target.value);
                  setAuditPage(1);
                }}
                placeholder="Lọc entity, ví dụ Transaction"
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
            </div>

            {auditQuery.isLoading ? (
              <LoadingRows />
            ) : auditQuery.isError ? (
              <EmptyState title="Không tải được audit logs" />
            ) : auditQuery.data?.items.length ? (
              <>
                <div className="divide-y divide-slate-100">
                  {auditQuery.data.items.map((item) => (
                    <article key={item.id} className="px-6 py-5">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">
                            {item.action}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {item.entity} · {compactId(item.entityId)} · actor{' '}
                            {compactId(item.actorId)}
                          </p>
                        </div>
                        <p className="text-sm text-slate-500">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <SnapshotDetails
                          title="Before"
                          value={item.beforeData}
                        />
                        <SnapshotDetails title="After" value={item.afterData} />
                      </div>
                    </article>
                  ))}
                </div>
                <Pagination
                  page={auditQuery.data.meta.page}
                  totalPages={auditTotalPages}
                  disabled={auditQuery.isFetching}
                  onPrevious={() =>
                    setAuditPage((current) => Math.max(1, current - 1))
                  }
                  onNext={() => setAuditPage((current) => current + 1)}
                />
              </>
            ) : (
              <EmptyState title="Không có audit log phù hợp" />
            )}
          </section>
        )}

        {tab === 'account-history' && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 px-6 py-5 md:grid-cols-[minmax(0,1fr)_120px]">
              <input
                value={historyAccountId}
                onChange={(event) => {
                  setHistoryAccountId(event.target.value);
                  setAccountHistoryPage(1);
                }}
                placeholder="Nhập accountId để xem account_history"
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
              <button
                type="button"
                onClick={() => accountHistoryQuery.refetch()}
                disabled={!historyAccountId.trim()}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Tải
              </button>
            </div>

            {!historyAccountId.trim() ? (
              <EmptyState title="Chọn account để xem history" />
            ) : accountHistoryQuery.isLoading ? (
              <LoadingRows />
            ) : accountHistoryQuery.isError ? (
              <EmptyState title="Không tải được account history" />
            ) : accountHistoryQuery.data?.items.length ? (
              <>
                <div className="divide-y divide-slate-100">
                  {accountHistoryQuery.data.items.map((item) => (
                    <article key={item.id} className="px-6 py-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">
                            {item.action}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDateTime(item.createdAt)} · actor{' '}
                            {compactId(item.changedById)}
                          </p>
                        </div>
                        <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {compactId(item.accountId)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <SnapshotDetails
                          title="Before"
                          value={item.beforeData}
                        />
                        <SnapshotDetails title="After" value={item.afterData} />
                      </div>
                    </article>
                  ))}
                </div>
                <Pagination
                  page={accountHistoryQuery.data.meta.page}
                  totalPages={accountHistoryTotalPages}
                  disabled={accountHistoryQuery.isFetching}
                  onPrevious={() =>
                    setAccountHistoryPage((current) => Math.max(1, current - 1))
                  }
                  onNext={() => setAccountHistoryPage((current) => current + 1)}
                />
              </>
            ) : (
              <EmptyState title="Account này chưa có history" />
            )}
          </section>
        )}
      </div>

      {reverseTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 px-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const reason = reverseReason.trim();
              if (!reason) return;
              setFeedback(null);
              reverseMutation.mutate({
                transactionId: reverseTarget.id,
                reason,
              });
            }}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="border-b border-slate-100 pb-5">
              <h2 className="font-semibold text-slate-900">Tạo reversal</h2>
              <p className="mt-1 text-sm text-slate-500">
                Transaction gốc: {compactId(reverseTarget.id)}
              </p>
            </div>

            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              <p>
                {reverseTarget.fromAccountNumber ?? '-'} →{' '}
                {reverseTarget.toAccountNumber ?? '-'}
              </p>
              <p className="mt-1 font-bold text-slate-900">
                {formatMoney(reverseTarget.amount)} VND
              </p>
            </div>

            <label className="mt-5 block text-sm font-medium text-slate-700">
              Lý do hoàn tiền
            </label>
            <textarea
              value={reverseReason}
              onChange={(event) =>
                setReverseReason(event.target.value.slice(0, 255))
              }
              rows={3}
              className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              placeholder="Ví dụ: Customer requested refund"
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setReverseTarget(null);
                  setReverseReason('');
                  reverseMutation.reset();
                }}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={reverseMutation.isPending || !reverseReason.trim()}
                className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reverseMutation.isPending
                  ? 'Đang xử lý...'
                  : 'Xác nhận reversal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </BankingLayout>
  );
}

function UserRow({
  user,
  busy,
  onToggleStatus,
  onDeleteUser,
  onDeleteAccount,
  onPickAccountHistory,
}: {
  user: AdminUser;
  busy: boolean;
  onToggleStatus: () => void;
  onDeleteUser: () => void;
  onDeleteAccount: (accountId: string) => void;
  onPickAccountHistory: (accountId: string) => void;
}) {
  return (
    <tr
      className={`transition hover:bg-slate-50/70 ${user.deletedAt ? 'opacity-60' : ''}`}
    >
      <td className="px-6 py-4">
        <p className="font-semibold text-slate-900">{user.fullName}</p>
        <p className="mt-1 break-all text-sm text-slate-500">{user.email}</p>
        <p className="mt-1 font-mono text-xs text-slate-400">
          {compactId(user.id)}
        </p>
      </td>
      <td className="px-6 py-4 text-sm font-semibold capitalize text-slate-700">
        {user.role}
      </td>
      <td className="px-6 py-4">
        <div className="space-y-2">
          {userStatusBadge(user.status)}
          {user.deletedAt && (
            <p className="text-xs font-medium text-red-600">
              Đã xóa {formatDateTime(user.deletedAt)}
            </p>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="space-y-3">
          {user.accounts.length ? (
            user.accounts.map((account) => (
              <div
                key={account.id}
                className="rounded-xl border border-slate-200 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-slate-800">
                      {account.accountNumber}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatMoney(account.balance)} {account.currency}
                    </p>
                    {account.deletedAt && (
                      <p className="mt-1 text-xs font-medium text-red-600">
                        Đã xóa {formatDateTime(account.deletedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onPickAccountHistory(account.id)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      History
                    </button>
                    {!account.deletedAt && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDeleteAccount(account.id)}
                        className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <span className="text-sm text-slate-400">Chưa có account</span>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex justify-end gap-2">
          {!user.deletedAt && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onToggleStatus}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {user.status === 'active' ? 'Khóa' : 'Mở'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDeleteUser}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Xóa user
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function SnapshotDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">
        {title}
      </summary>
      <pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-600">
        {formatJson(value)}
      </pre>
    </details>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-xl bg-slate-100"
        />
      ))}
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-semibold text-slate-800">{title}</p>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  disabled,
  onPrevious,
  onNext,
}: {
  page: number;
  totalPages: number;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
      <p className="text-sm text-slate-500">
        Trang {page} / {Math.max(totalPages, 1)}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1 || disabled}
          onClick={onPrevious}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Trang trước
        </button>
        <button
          type="button"
          disabled={page >= totalPages || disabled}
          onClick={onNext}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Trang sau
        </button>
      </div>
    </div>
  );
}
