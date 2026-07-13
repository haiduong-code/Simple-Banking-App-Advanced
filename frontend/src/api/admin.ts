import api from '../lib/api';
import type {
  AdminUser,
  AdminTransactionsParams,
  AdminTransactionsResponse,
  AdminUsersParams,
  AdminUsersResponse,
  DeleteAccountResult,
  DeleteUserResult,
} from '../types/admin';
import type { UserStatus } from '../types/users';

export async function getAdminUsers(
  params: AdminUsersParams,
): Promise<AdminUsersResponse> {
  const { data } = await api.get<AdminUsersResponse>('/admin/users', {
    params,
  });
  return data;
}

export async function updateAdminUserStatus(
  userId: string,
  status: UserStatus,
) : Promise<AdminUser> {
  const { data } = await api.patch<AdminUser>(`/admin/users/${userId}/status`, {
    status,
  });
  return data;
}

export async function softDeleteAdminUser(
  userId: string,
): Promise<DeleteUserResult> {
  const { data } = await api.delete<DeleteUserResult>(`/admin/users/${userId}`);
  return data;
}

export async function softDeleteAdminAccount(
  accountId: string,
): Promise<DeleteAccountResult> {
  const { data } = await api.delete<DeleteAccountResult>(
    `/admin/accounts/${accountId}`,
  );
  return data;
}

export async function getAdminTransactions(
  params: AdminTransactionsParams,
): Promise<AdminTransactionsResponse> {
  const { data } = await api.get<AdminTransactionsResponse>(
    '/admin/transactions',
    { params },
  );
  return data;
}
