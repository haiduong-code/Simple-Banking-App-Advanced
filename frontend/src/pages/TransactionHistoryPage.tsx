import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTransactionHistory,
  reverseTransaction,
} from '../api/transactions';
import BankingLayout from '../components/BankingLayout';
import { getErrorMessage } from '../lib/api';
import { compactId } from '../lib/format';
import { formatMoney } from '../lib/money';
import type {
  TransactionDirection,
  TransactionItem,
} from '../types/transactions';

const PAGE_SIZE = 10;

const filters: Array<{ value: TransactionDirection; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'incoming', label: 'Tiền vào' },
  { value: 'outgoing', label: 'Tiền ra' },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getCounterparty(transaction: TransactionItem): string {
  return transaction.direction === 'outgoing'
    ? transaction.toAccountNumber || 'Không xác định'
    : transaction.fromAccountNumber || 'Không xác định';
}

function canReverse(transaction: TransactionItem): boolean {
  return (
    transaction.type === 'transfer' &&
    transaction.status === 'completed' &&
    !transaction.reversalTransactionId
  );
}

export default function TransactionHistoryPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<TransactionDirection>('all');
  const [reverseTarget, setReverseTarget] = useState<TransactionItem | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['transactions', { page, direction }],
    queryFn: () =>
      getTransactionHistory({ page, limit: PAGE_SIZE, direction }),
    placeholderData: (previousData) => previousData,
  });

  const reverseMutation = useMutation({
    mutationFn: ({ transactionId, reason }: { transactionId: string; reason: string }) =>
      reverseTransaction(transactionId, { reason }),
    onSuccess: async () => {
      setMessage('Đã tạo giao dịch reversal thành công');
      setReverseTarget(null);
      setReverseReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['my-account'] }),
      ]);
    },
  });

  const changeDirection = (value: TransactionDirection) => {
    setDirection(value);
    setPage(1);
    setMessage(null);
  };

  const totalPages = data?.meta.totalPages ?? 0;

  return (
    <BankingLayout
      title="Lịch sử giao dịch"
      subtitle="Theo dõi toàn bộ các khoản tiền vào và tiền ra của tài khoản."
    >
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Danh sách giao dịch</h2>
            <p className="mt-1 text-sm text-slate-500">
              {data ? `${data.meta.total} giao dịch được tìm thấy` : 'Đang tải dữ liệu'}
            </p>
          </div>

          <div className="flex rounded-xl bg-slate-100 p-1">
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => changeDirection(filter.value)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  direction === filter.value
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {reverseMutation.isError && (
          <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">
            {getErrorMessage(reverseMutation.error, 'Không thể hoàn tiền giao dịch')}
          </div>
        )}

        {message && (
          <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-3 text-sm font-medium text-emerald-700">
            {message}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold text-slate-800">Không tải được lịch sử giao dịch</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Thử lại
            </button>
          </div>
        ) : data?.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Thời gian</th>
                    <th className="px-6 py-3 font-semibold">Loại giao dịch</th>
                    <th className="px-6 py-3 font-semibold">Tài khoản đối ứng</th>
                    <th className="px-6 py-3 font-semibold">Nội dung</th>
                    <th className="px-6 py-3 text-right font-semibold">Số tiền</th>
                    <th className="px-6 py-3 text-center font-semibold">Trạng thái</th>
                    <th className="px-6 py-3 text-right font-semibold">Thao tác</th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-slate-100 ${isFetching ? 'opacity-60' : ''}`}>
                  {data.items.map((transaction) => {
                    const incoming = transaction.direction === 'incoming';
                    return (
                      <tr key={transaction.id} className="transition hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                          {formatDate(transaction.createdAt)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span
                              className={`grid h-9 w-9 place-items-center rounded-full text-lg font-bold ${
                                incoming
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-orange-100 text-orange-700'
                              }`}
                            >
                              {incoming ? '↓' : '↑'}
                            </span>
                            <span className="text-sm font-medium text-slate-800">
                              {incoming ? 'Tiền vào' : 'Tiền ra'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm text-slate-700">
                          {getCounterparty(transaction)}
                        </td>
                        <td className="max-w-[220px] truncate px-6 py-4 text-sm text-slate-600">
                          {transaction.description || 'Chuyển khoản nội bộ'}
                        </td>
                        <td
                          className={`whitespace-nowrap px-6 py-4 text-right text-sm font-bold ${
                            incoming ? 'text-emerald-600' : 'text-slate-800'
                          }`}
                        >
                          {incoming ? '+' : '-'} {formatMoney(transaction.amount)} VND
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              transaction.status === 'completed'
                                ? 'bg-emerald-50 text-emerald-700'
                                : transaction.status === 'pending'
                                  ? 'bg-amber-50 text-amber-700'
                                  : transaction.status === 'reversed'
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {transaction.status === 'completed'
                              ? 'Thành công'
                              : transaction.status === 'pending'
                                ? 'Đang xử lý'
                                : transaction.status === 'reversed'
                                  ? 'Đã hoàn'
                                  : 'Thất bại'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {canReverse(transaction) ? (
                            <button
                              type="button"
                              onClick={() => {
                                setReverseTarget(transaction);
                                setReverseReason('');
                                setMessage(null);
                                reverseMutation.reset();
                              }}
                              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
                            >
                              Hoàn tiền
                            </button>
                          ) : transaction.reversalTransactionId ? (
                            <span className="font-mono text-xs text-slate-400">
                              {compactId(transaction.reversalTransactionId)}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
              <p className="text-sm text-slate-500">
                Trang {data.meta.page} / {Math.max(totalPages, 1)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Trang trước
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || isFetching}
                  onClick={() => setPage((current) => current + 1)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Trang sau
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-6 py-16 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-2xl text-slate-400">
              ↔
            </span>
            <p className="mt-4 font-semibold text-slate-800">Chưa có giao dịch</p>
            <p className="mt-1 text-sm text-slate-500">
              Các khoản tiền vào và tiền ra sẽ xuất hiện tại đây.
            </p>
          </div>
        )}
      </section>

      {reverseTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 px-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const reason = reverseReason.trim();
              if (!reason) return;
              reverseMutation.mutate({
                transactionId: reverseTarget.id,
                reason,
              });
            }}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="border-b border-slate-100 pb-5">
              <h2 className="font-semibold text-slate-900">Hoàn tiền giao dịch</h2>
              <p className="mt-1 text-sm text-slate-500">
                Transaction: {compactId(reverseTarget.id)}
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
              onChange={(event) => setReverseReason(event.target.value.slice(0, 255))}
              rows={3}
              placeholder="Ví dụ: Người nhận yêu cầu hoàn tiền"
              className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
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
                {reverseMutation.isPending ? 'Đang xử lý...' : 'Xác nhận hoàn tiền'}
              </button>
            </div>
          </form>
        </div>
      )}
    </BankingLayout>
  );
}
