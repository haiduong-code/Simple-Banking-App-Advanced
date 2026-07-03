export type TransactionDirection = 'all' | 'incoming' | 'outgoing';
export type TransactionStatus = 'success' | 'failed' | 'pending';
export type TransactionType = 'transfer' | 'deposit';

export interface TransferPayload {
  toAccountNumber: string;
  amount: string;
  description?: string;
}

export interface TransferResult {
  id: string;
  fromAccountNumber: string | null;
  toAccountNumber: string | null;
  amount: string;
  status: TransactionStatus;
  description: string | null;
  createdAt: string;
}

export interface TransactionItem {
  id: string;
  direction: Exclude<TransactionDirection, 'all'>;
  fromAccountNumber: string | null;
  toAccountNumber: string | null;
  amount: string;
  type: TransactionType;
  status: TransactionStatus;
  description: string | null;
  createdAt: string;
}

export interface TransactionHistoryParams {
  page?: number;
  limit?: number;
  direction?: TransactionDirection;
}

export interface TransactionHistoryResponse {
  items: TransactionItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
