import type { SafeUser } from './auth';
import type { HistorySnapshot } from './accounts';

export type UserRole = 'customer' | 'admin';
export type UserStatus = 'active' | 'locked';

export interface UpdateMePayload {
  fullName?: string;
  email?: string;
}

export type UpdateMeResult = SafeUser;

export interface UserHistoryItem {
  id: string;
  userId: string;
  changedById: string | null;
  action: string;
  beforeData: HistorySnapshot;
  afterData: HistorySnapshot | null;
  createdAt: string;
}

export interface UserHistoryParams {
  page?: number;
  limit?: number;
  action?: string;
}

export interface UserHistoryResponse {
  items: UserHistoryItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
