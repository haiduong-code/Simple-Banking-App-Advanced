import api from '../lib/api';
import type {
  TransactionHistoryParams,
  TransactionHistoryResponse,
  TransferPayload,
  TransferResult,
} from '../types/transactions';

export async function transferMoney(
  payload: TransferPayload,
  idempotencyKey: string,
): Promise<TransferResult> {
  const { data } = await api.post<TransferResult>(
    '/transactions/transfer',
    payload,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

export async function getTransactionHistory(
  params: TransactionHistoryParams,
): Promise<TransactionHistoryResponse> {
  const { data } = await api.get<TransactionHistoryResponse>('/transactions', {
    params,
  });
  return data;
}
