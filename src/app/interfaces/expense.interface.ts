export interface ExpenseShare {
  mateId: string;
  amountCents: number;
}

export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  shares: ExpenseShare[];
  // ISO date string in the application; stored as a Timestamp in Firestore.
  createdAt: string;
}

export interface ExpenseDraft {
  description: string;
  amountCents: number;
  payerId: string;
  participantIds: string[];
}
