import api from '../lib/api';
import type {
  Account,
  AccountHistoryParams,
  AccountHistoryResponse,
} from '../types/accounts';

export async function getMyAccount(): Promise<Account> {
  const { data } = await api.get<Account>('/accounts/me');
  return data;
}

export async function getAccountHistory(
  accountId: string,
  params: AccountHistoryParams,
): Promise<AccountHistoryResponse> {
  const { data } = await api.get<AccountHistoryResponse>(
    `/accounts/${accountId}/history`,
    { params },
  );
  return data;
}
