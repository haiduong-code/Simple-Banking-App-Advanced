import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import BankingLayout from '../components/BankingLayout';
import { postMoney } from '../api/transactions';
import { getErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { transactionStatusLabels } from '../lib/transaction-labels';

export default function CashPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('withdraw');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const request = useRef({ key, fingerprint: '' });
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        amount,
        ...(account ? { fromAccountNumber: account } : {}),
      };
      const fingerprint = JSON.stringify({ kind, payload });
      if (
        request.current.fingerprint &&
        request.current.fingerprint !== fingerprint
      )
        request.current.key = crypto.randomUUID();
      request.current.fingerprint = fingerprint;
      return postMoney(`/transactions/${kind}`, payload, request.current.key);
    },
    onSuccess: async () => {
      const next = crypto.randomUUID();
      setKey(next);
      request.current = { key: next, fingerprint: '' };
      setAmount('');
      await queryClient.invalidateQueries({ queryKey: ['my-account'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  return (
    <BankingLayout
      title="Nạp / rút tiền"
      subtitle="Giao dịch tiền mặt được ghi nhận vào sổ cái và lịch sử tài khoản."
    >
      <form
        className="max-w-xl space-y-4 rounded-2xl bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting.current) {
            submitting.current = true;
            mutation.mutate();
          }
        }}
      >
        <label className="block">
          Loại giao dịch
          <select
            className="mt-2 w-full rounded-lg border p-3"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={mutation.isPending}
          >
            <option value="withdraw">Rút tiền</option>
            {user?.role !== 'customer' && (
              <option value="deposit">Nạp tiền</option>
            )}
          </select>
        </label>
        {user?.role !== 'customer' && (
          <label className="block">
            Số tài khoản khách hàng (để trống nếu dùng tài khoản của bạn)
            <input
              className="mt-2 w-full rounded-lg border p-3"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              pattern="[0-9]{10}"
              disabled={mutation.isPending}
            />
          </label>
        )}
        <label className="block">
          Số tiền (VND)
          <input
            className="mt-2 w-full rounded-lg border p-3"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            disabled={mutation.isPending}
          />
        </label>
        <button
          disabled={mutation.isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Đang xử lý...' : 'Xác nhận'}
        </button>
        {mutation.isError && (
          <p role="alert" className="text-red-600">
            {getErrorMessage(mutation.error)}
          </p>
        )}
        {mutation.data && (
          <p>
            {transactionStatusLabels[mutation.data.status]}.{' '}
            <Link
              className="text-emerald-700 underline"
              to={`/transactions/${mutation.data.id}`}
            >
              Xem giao dịch / xác nhận OTP
            </Link>
          </p>
        )}
      </form>
    </BankingLayout>
  );
}
