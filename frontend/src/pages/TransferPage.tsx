import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyAccount } from '../api/accounts';
import { transferMoney } from '../api/transactions';
import BankingLayout from '../components/BankingLayout';
import { getErrorMessage } from '../lib/api';
import {
  formatMoney,
  isValidMoney,
  moneyToMinorUnits,
  normalizeMoneyInput,
} from '../lib/money';
import type { TransferPayload, TransferResult } from '../types/transactions';

interface FormErrors {
  toAccountNumber?: string;
  amount?: string;
  description?: string;
}

interface IdempotencyRequest {
  fingerprint: string;
  key: string;
}

export default function TransferPage() {
  const queryClient = useQueryClient();
  const idempotencyRequest = useRef<IdempotencyRequest | null>(null);
  const [toAccountNumber, setToAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<TransferResult | null>(null);

  const { data: account, isLoading: accountLoading } = useQuery({
    queryKey: ['my-account'],
    queryFn: getMyAccount,
  });

  const mutation = useMutation({
    mutationFn: ({ payload, key }: { payload: TransferPayload; key: string }) =>
      transferMoney(payload, key),
    onSuccess: async (data) => {
      setResult(data);
      idempotencyRequest.current = null;
      setAmount('');
      setDescription('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-account'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ]);
    },
  });

  const clearFeedback = (field: keyof FormErrors) => {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setResult(null);
    mutation.reset();
  };

  const validate = (normalizedAmount: string): boolean => {
    const nextErrors: FormErrors = {};

    if (!/^\d{10}$/.test(toAccountNumber)) {
      nextErrors.toAccountNumber = 'Số tài khoản phải gồm đúng 10 chữ số';
    } else if (account?.accountNumber === toAccountNumber) {
      nextErrors.toAccountNumber = 'Không thể chuyển tiền cho chính tài khoản này';
    }

    if (!isValidMoney(normalizedAmount)) {
      nextErrors.amount = 'Nhập số tiền hợp lệ, tối đa 2 chữ số thập phân';
    } else {
      const amountInMinorUnits = moneyToMinorUnits(normalizedAmount);
      if (amountInMinorUnits <= 0n) {
        nextErrors.amount = 'Số tiền phải lớn hơn 0';
      } else if (
        account &&
        amountInMinorUnits > moneyToMinorUnits(account.balance)
      ) {
        nextErrors.amount = 'Số dư khả dụng không đủ';
      }
    }

    if (description.trim().length > 255) {
      nextErrors.description = 'Nội dung không được vượt quá 255 ký tự';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedAmount = normalizeMoneyInput(amount);
    if (!validate(normalizedAmount)) return;

    const payload: TransferPayload = {
      toAccountNumber,
      amount: normalizedAmount,
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    const fingerprint = JSON.stringify(payload);

    if (idempotencyRequest.current?.fingerprint !== fingerprint) {
      idempotencyRequest.current = {
        fingerprint,
        key: crypto.randomUUID(),
      };
    }

    mutation.mutate({
      payload,
      key: idempotencyRequest.current.key,
    });
  };

  return (
    <BankingLayout
      title="Chuyển khoản nội bộ"
      subtitle="Chuyển tiền tức thời tới một tài khoản khác trong hệ thống."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <h2 className="font-semibold text-slate-900">Thông tin người nhận</h2>
              <p className="mt-1 text-sm text-slate-500">
                Kiểm tra kỹ số tài khoản và số tiền trước khi xác nhận.
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Nội bộ
            </span>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Số tài khoản nhận
              </label>
              <input
                value={toAccountNumber}
                onChange={(event) => {
                  setToAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 10));
                  clearFeedback('toAccountNumber');
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Nhập 10 chữ số"
                className={`w-full rounded-xl border px-4 py-3 text-base outline-none transition focus:ring-4 ${
                  errors.toAccountNumber
                    ? 'border-red-300 focus:border-red-400 focus:ring-red-50'
                    : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-50'
                }`}
              />
              {errors.toAccountNumber && (
                <p className="mt-1.5 text-sm text-red-600">{errors.toAccountNumber}</p>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Số tiền</label>
                {account && (
                  <button
                    type="button"
                    onClick={() => {
                      setAmount(account.balance);
                      clearFeedback('amount');
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Chuyển toàn bộ
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value.replace(/[^\d.,]/g, '').slice(0, 19));
                    clearFeedback('amount');
                  }}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className={`w-full rounded-xl border px-4 py-3 pr-16 text-lg font-semibold outline-none transition focus:ring-4 ${
                    errors.amount
                      ? 'border-red-300 focus:border-red-400 focus:ring-red-50'
                      : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-50'
                  }`}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">
                  VND
                </span>
              </div>
              {errors.amount ? (
                <p className="mt-1.5 text-sm text-red-600">{errors.amount}</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-500">
                  Có thể dùng dấu chấm hoặc dấu phẩy cho phần thập phân.
                </p>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Nội dung chuyển khoản
                </label>
                <span className="text-xs text-slate-400">{description.length}/255</span>
              </div>
              <textarea
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value.slice(0, 255));
                  clearFeedback('description');
                }}
                rows={3}
                placeholder="Ví dụ: Thanh toán tiền ăn"
                className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
              />
              {errors.description && (
                <p className="mt-1.5 text-sm text-red-600">{errors.description}</p>
              )}
            </div>
          </div>

          {mutation.isError && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {getErrorMessage(mutation.error, 'Không thể thực hiện chuyển khoản')}
              <p className="mt-1 text-xs text-red-500">
                Bạn có thể thử lại; hệ thống sẽ không tạo giao dịch trùng.
              </p>
            </div>
          )}

          {result && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="font-semibold text-emerald-800">Chuyển khoản thành công</p>
              <p className="mt-1 text-sm text-emerald-700">
                Đã chuyển {formatMoney(result.amount)} VND tới tài khoản{' '}
                {result.toAccountNumber}.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={mutation.isPending || accountLoading || !account}
            className="mt-6 w-full rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? 'Đang xử lý...' : 'Xác nhận chuyển khoản'}
          </button>
        </form>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 p-6 text-white shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">
              Tài khoản nguồn
            </p>
            {accountLoading ? (
              <div className="mt-5 h-16 animate-pulse rounded-lg bg-white/15" />
            ) : account ? (
              <>
                <p className="mt-5 font-mono text-lg tracking-wider">
                  {account.accountNumber}
                </p>
                <p className="mt-5 text-xs text-emerald-100">Số dư khả dụng</p>
                <p className="mt-1 text-2xl font-bold">
                  {formatMoney(account.balance)}{' '}
                  <span className="text-base font-semibold">{account.currency}</span>
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-red-100">Không tải được tài khoản.</p>
            )}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">Lưu ý an toàn</p>
            <ul className="mt-3 space-y-2 text-amber-800">
              <li>• Không chuyển tiền vào chính tài khoản nguồn.</li>
              <li>• Giao dịch thành công sẽ cập nhật số dư ngay lập tức.</li>
              <li>• Không đóng trang khi hệ thống đang xử lý.</li>
            </ul>
          </div>
        </aside>
      </div>
    </BankingLayout>
  );
}
