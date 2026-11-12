import type { TransactionStatus, TransactionType } from '../types/transactions';
export const transactionStatusLabels: Record<TransactionStatus, string> = {
  initiated: 'Đã khởi tạo',
  pending: 'Đang chờ',
  pending_otp: 'Chờ OTP',
  pending_approval: 'Chờ admin duyệt',
  processing: 'Đang xử lý',
  completed: 'Thành công',
  failed: 'Thất bại',
  reversed: 'Đã hoàn tiền',
};
export const transactionTypeLabels: Record<TransactionType, string> = {
  transfer: 'Chuyển khoản',
  deposit: 'Nạp tiền',
  withdrawal: 'Rút tiền',
  reversal: 'Hoàn tiền',
  opening_balance: 'Số dư đầu kỳ',
};
