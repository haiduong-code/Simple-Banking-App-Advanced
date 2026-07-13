import api from '../lib/api';
import type {
  ReverseTransactionPayload,
  ReverseTransactionResult,
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

export async function reverseTransaction(
  transactionId: string,
  payload: ReverseTransactionPayload,
): Promise<ReverseTransactionResult> {
  const { data } = await api.post<ReverseTransactionResult>(
    `/transactions/${transactionId}/reverse`,
    payload,
  );
  return data;
}
