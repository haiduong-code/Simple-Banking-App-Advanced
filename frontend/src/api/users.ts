import api from '../lib/api';
import type {
  UpdateMePayload,
  UpdateMeResult,
  UserHistoryParams,
  UserHistoryResponse,
} from '../types/users';

export async function updateMe(
  payload: UpdateMePayload,
): Promise<UpdateMeResult> {
  const { data } = await api.patch<UpdateMeResult>('/users/me', payload);
  return data;
}

export async function getMyUserHistory(
  params: UserHistoryParams,
): Promise<UserHistoryResponse> {
  const { data } = await api.get<UserHistoryResponse>('/users/me/history', {
    params,
  });
  return data;
}
