export interface Reimbursement {
  id: string;
  fromMateId: string;
  toMateId: string;
  amountCents: number;
  // ISO date string in the application; stored as a Timestamp in Firestore.
  createdAt: string;
}

export interface ReimbursementDraft {
  fromMateId: string;
  toMateId: string;
  amountCents: number;
}

export interface ReimbursementBatchDraft {
  fromMateId: string;
  recipients: { toMateId: string; amountCents: number }[];
}
