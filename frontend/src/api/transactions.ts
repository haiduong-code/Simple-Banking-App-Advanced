import api from '../lib/api';
import axios from 'axios';
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
  return postMoney('/transactions/transfer', payload, idempotencyKey);
}

export async function postMoney(
  path: string,
  payload: object,
  key: string,
): Promise<TransferResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await api.post<TransferResult>(path, payload, {
        headers: { 'Idempotency-Key': key },
      });
      return data;
    } catch (error) {
      if (
        attempt >= 2 ||
        !axios.isAxiosError(error) ||
        error.code === 'ERR_CANCELED' ||
        (error.response && error.response.status < 500)
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
    }
  }
}

export async function getTransaction(id: string): Promise<TransferResult> {
  return (await api.get<TransferResult>(`/transactions/${id}`)).data;
}

export async function verifyTransactionOtp(
  id: string,
  code: string,
): Promise<TransferResult> {
  return (
    await api.post<TransferResult>(`/transactions/${id}/verify-otp`, { code })
  ).data;
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
