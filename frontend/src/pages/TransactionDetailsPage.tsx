import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTransaction, verifyTransactionOtp } from '../api/transactions';
import BankingLayout from '../components/BankingLayout';
import { formatMoney } from '../lib/money';
import { getErrorMessage } from '../lib/api';
import { transactionStatusLabels } from '../lib/transaction-labels';

export default function TransactionDetailsPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const query = useQuery({
    queryKey: ['transaction', id],
    queryFn: () => getTransaction(id),
    refetchInterval: 5000,
  });
  const verify = useMutation({
    mutationFn: () => verifyTransactionOtp(id, code),
    onSuccess: async () => {
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['transaction', id] });
    },
  });
  const tx = query.data;
  return (
    <BankingLayout
      title="Chi tiết giao dịch"
      subtitle="Xác nhận giao dịch và theo dõi kết quả xử lý."
    >
      <section className="max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        {query.isLoading && <p>Đang tải...</p>}
        {query.isError && <p role="alert">{getErrorMessage(query.error)}</p>}
        {tx && (
          <>
            <p className="break-all text-xs text-slate-500">{tx.id}</p>
            <p className="text-2xl font-bold">{formatMoney(tx.amount)} VND</p>
            <p>
              {tx.fromAccountNumber ?? 'Tiền mặt'} →{' '}
              {tx.toAccountNumber ?? 'Tiền mặt'}
            </p>
            <p className="font-semibold text-emerald-700">
              {transactionStatusLabels[tx.status]}
            </p>
            {tx.status === 'pending_approval' && (
              <p>
                OTP đã được xác nhận. Giao dịch sẽ thực hiện khi admin duyệt; số
                dư được kiểm tra lại trước khi chuyển tiền.
              </p>
            )}
            {tx.status === 'pending_otp' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!verify.isPending) verify.mutate();
                }}
                className="space-y-3"
              >
                <label className="block">
                  Nhập mã OTP 6 số (hết hạn sau 5 phút)
                  <input
                    aria-label="Mã OTP"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    required
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-lg border p-3"
                  />
                </label>
                <button
                  disabled={verify.isPending || code.length !== 6}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
                >
                  {verify.isPending ? 'Đang xác nhận...' : 'Xác nhận OTP'}
                </button>
              </form>
            )}
            {verify.isError && (
              <p role="alert" className="text-red-600">
                {getErrorMessage(verify.error)}
              </p>
            )}
          </>
        )}
      </section>
    </BankingLayout>
  );
}
