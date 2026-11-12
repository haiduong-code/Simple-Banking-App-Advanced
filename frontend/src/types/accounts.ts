export interface Account {
  id: string;
  accountNumber: string;
  balance: string;
  availableBalance?: string;
  holdAmount?: string;
  status?: 'active' | 'frozen' | 'closed';
  tier?: 'standard' | 'vip';
  version?: number;
  currency: string;
  createdAt: string;
  deletedAt?: string | null;
}

export type HistorySnapshot = Record<string, unknown>;

export interface AccountHistoryItem {
  id: string;
  accountId: string;
  changedById: string | null;
  action: string;
  beforeData: HistorySnapshot;
  afterData: HistorySnapshot | null;
  createdAt: string;
}

export interface AccountHistoryParams {
  page?: number;
  limit?: number;
  action?: string;
}

export interface AccountHistoryResponse {
  items: AccountHistoryItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
