import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import BankingLayout from '../components/BankingLayout';
import api, { getErrorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import type { AdminTransaction } from '../types/admin';
interface Flagged {
  id: string;
  amount: string;
  reviewReasons: string[];
  reviewDecision: string | null;
}
interface Report {
  id: string;
  createdAt: string;
  status: string;
  checkedAccounts: number;
  mismatches: Array<{
    accountId: string;
    cachedBalance: string;
    ledgerBalance: string;
  }>;
}
export default function AdminOperationsPage() {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('active');
  const [tier, setTier] = useState('standard');
  const pending = useQuery({
    queryKey: ['operations', 'pending'],
    queryFn: async () =>
      (
        await api.get<{ items: AdminTransaction[] }>('/admin/transactions', {
          params: { status: 'pending_approval', limit: 100 },
        })
      ).data.items,
    refetchInterval: 10000,
  });
  const flagged = useQuery({
    queryKey: ['operations', 'flagged'],
    queryFn: async () =>
      (await api.get<Flagged[]>('/admin/monitoring/flagged')).data,
  });
  const reports = useQuery({
    queryKey: ['operations', 'reports'],
    queryFn: async () =>
      (await api.get<Report[]>('/admin/monitoring/reports')).data,
  });
  const action = useMutation({
    mutationFn: (path: string) => api.post(path),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['operations'] }),
  });
  const settings = useMutation({
    mutationFn: () => api.patch(`/accounts/${accountId}`, { status, tier }),
  });
  const button = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-50';
  return (
    <BankingLayout
      title="Duyệt giao dịch & đối soát"
      subtitle="Xem các yêu cầu chờ duyệt, cảnh báo bất thường và báo cáo sổ cái."
    >
      <div className="space-y-6">
        {(action.isError ||
          settings.isError ||
          pending.isError ||
          flagged.isError ||
          reports.isError) && (
          <p role="alert" className="text-red-600">
            {getErrorMessage(
              action.error ??
                settings.error ??
                pending.error ??
                flagged.error ??
                reports.error,
            )}
          </p>
        )}
        <section className="space-y-3 rounded-2xl bg-white p-6">
          <h2 className="font-bold">Giao dịch lớn đã xác nhận OTP</h2>
          {pending.data?.length === 0 && <p>Không có yêu cầu chờ duyệt.</p>}
          {pending.data?.map((tx) => (
            <div
              key={tx.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t py-3"
            >
              <div>
                <p>
                  {tx.fromAccountNumber} →{' '}
                  {tx.toAccountNumber ?? 'Rút tiền mặt'}
                </p>
                <p>{formatMoney(tx.amount)} VND</p>
                <small>{tx.id}</small>
              </div>
              <div className="flex gap-2">
                <button
                  className={button}
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate(`/transactions/${tx.id}/approve`)
                  }
                >
                  Duyệt
                </button>
                <button
                  className={button}
                  disabled={action.isPending}
                  onClick={() => action.mutate(`/transactions/${tx.id}/reject`)}
                >
                  Từ chối
                </button>
              </div>
            </div>
          ))}
        </section>
        <section className="space-y-3 rounded-2xl bg-white p-6">
          <h2 className="font-bold">Giao dịch cần kiểm tra</h2>
          {flagged.data
            ?.filter((tx) => !tx.reviewDecision)
            .map((tx) => (
              <div key={tx.id} className="space-y-2 border-t py-3">
                <p>
                  {tx.id} · {formatMoney(tx.amount)} VND
                </p>
                <p>{tx.reviewReasons.join(', ')}</p>
                <div className="flex gap-2">
                  {(['approved', 'rejected'] as const).map((decision) => (
                    <ReviewButton
                      key={decision}
                      id={tx.id}
                      decision={decision}
                    />
                  ))}
                </div>
              </div>
            ))}
        </section>
        <section className="space-y-3 rounded-2xl bg-white p-6">
          <h2 className="font-bold">Đối soát tài khoản và sổ cái</h2>
          <button
            className={button}
            disabled={action.isPending}
            onClick={() => action.mutate('/admin/monitoring/reconcile')}
          >
            Chạy đối soát
          </button>
          {reports.data?.map((report) => (
            <div key={report.id} className="border-t py-3">
              <p>
                {new Date(report.createdAt).toLocaleString('vi-VN')} ·{' '}
                {report.status} · {report.checkedAccounts} tài khoản
              </p>
              {report.mismatches.map((row) => (
                <p key={row.accountId} className="text-red-600">
                  {row.accountId}: số dư {row.cachedBalance}, sổ cái{' '}
                  {row.ledgerBalance}
                </p>
              ))}
            </div>
          ))}
        </section>
        <form
          className="space-y-3 rounded-2xl bg-white p-6"
          onSubmit={(e) => {
            e.preventDefault();
            settings.mutate();
          }}
        >
          <h2 className="font-bold">Trạng thái & hạng tài khoản</h2>
          <label className="block">
            ID tài khoản
            <input
              className="ml-3 rounded border p-2"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            />
          </label>
          <select
            aria-label="Trạng thái tài khoản"
            className="rounded border p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {['active', 'frozen', 'closed'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Hạng tài khoản"
            className="ml-2 rounded border p-2"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            <option value="standard">Thường</option>
            <option value="vip">VIP</option>
          </select>
          <button className={`${button} ml-2`} disabled={settings.isPending}>
            Lưu thay đổi
          </button>
          {settings.isSuccess && <p>Đã cập nhật và ghi lịch sử thay đổi.</p>}
        </form>
      </div>
    </BankingLayout>
  );
}
function ReviewButton({
  id,
  decision,
}: {
  id: string;
  decision: 'approved' | 'rejected';
}) {
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: () =>
      api.post(`/admin/monitoring/flagged/${id}/review`, { decision }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['operations'] }),
  });
  return (
    <>
      <button
        className="rounded border px-3 py-2 text-sm disabled:opacity-50"
        disabled={review.isPending}
        onClick={() => review.mutate()}
      >
        {decision === 'approved' ? 'Hợp lệ' : 'Đánh dấu nghi vấn'}
      </button>
      {review.isError && (
        <span role="alert">{getErrorMessage(review.error)}</span>
      )}
    </>
  );
}
