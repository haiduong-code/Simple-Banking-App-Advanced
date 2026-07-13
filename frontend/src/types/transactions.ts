export type TransactionDirection = "all" | "incoming" | "outgoing";
export type TransactionStatus = "pending" | "completed" | "failed" | "reversed";
export type TransactionType =
  "transfer" | "deposit" | "reversal" | "opening_balance";

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
  originalTransactionId: string | null;
  reversalTransactionId: string | null;
  description: string | null;
  createdAt: string;
  completedAt: string | null;
  reversedAt: string | null;
}

export interface ReverseTransactionPayload {
  reason: string;
}

export interface ReverseTransactionResult {
  originalTransaction: TransferResult;
  reversalTransaction: TransferResult;
}

export interface TransactionItem {
  id: string;
  direction: Exclude<TransactionDirection, "all">;
  fromAccountNumber: string | null;
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
