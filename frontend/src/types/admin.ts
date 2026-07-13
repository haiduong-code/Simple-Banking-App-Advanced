import type { Account } from './accounts';
import type {
  TransactionStatus,
  TransactionType,
} from './transactions';
import type { UserRole, UserStatus } from './users';

export interface AdminAccount extends Account {
  userId?: string;
  deletedAt: string | null;
}

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  deletedAt: string | null;
  accounts: AdminAccount[];
}

export interface AdminUsersParams {
  page?: number;
  limit?: number;
  status?: UserStatus;
  role?: UserRole;
  search?: string;
  includeDeleted?: boolean;
}

export interface AdminUsersResponse {
  items: AdminUser[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AdminTransaction {
  id: string;
  fromAccountId: string | null;
  fromAccountNumber: string | null;
  toAccountId: string | null;
  toAccountNumber: string | null;
  amount: string;
  type: TransactionType;
  status: TransactionStatus;
  originalTransactionId: string | null;
  reversalTransactionId: string | null;
  description: string | null;
  createdAt: string;
  completedAt: string | null;
  reversedAt: string | null;
}

export interface AdminTransactionsParams {
  page?: number;
  limit?: number;
  type?: TransactionType;
  status?: TransactionStatus;
  accountId?: string;
}

export interface AdminTransactionsResponse {
  items: AdminTransaction[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DeleteUserResult {
  deleted: boolean;
  userId: string;
}

export interface DeleteAccountResult {
  deleted: boolean;
  accountId: string;
}
