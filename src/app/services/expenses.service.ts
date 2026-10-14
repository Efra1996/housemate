import { Injectable, inject } from '@angular/core';
import { Timestamp, collection, doc, getDocsFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Expense, ExpenseDraft, ExpenseShare } from '../interfaces/expense.interface';
import type { Mate } from '../interfaces/mate.interface';
import { splitExpense } from '../expenses/expense-calculations';
import { FirebaseService } from './firebase.service';
import { MatesService } from './mates.service';

@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private readonly firebase = inject(FirebaseService);
  private readonly matesService = inject(MatesService);
  private readonly storageKey = 'housemate.expenses.v1';

  // Sample members retained for the existing local-storage methods only.
  readonly mates: readonly Mate[] = [
    { id: '1', nombre: 'Maya', avatar: 'MA' },
    { id: '2', nombre: 'Álex', avatar: 'ÁL' },
    { id: '3', nombre: 'Sam', avatar: 'SA' },
    { id: '4', nombre: 'Dani', avatar: 'DA' },
    { id: '5', nombre: 'Efra', avatar: 'EF' },
  ];

  async getExpensesFromFirestore(): Promise<Expense[]> {
    const [snapshot, mates] = await Promise.all([
      getDocsFromServer(collection(this.firebase.firestore, 'expenses')),
      this.matesService.getMates(),
    ]);
    return snapshot.docs.map((document) => this.readFirestoreExpense(document.id, document.data(), mates))
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }

  async saveExpenseToFirestore(draft: ExpenseDraft): Promise<void> {
    // Capture the draft before asynchronous reads; never mutate the caller's selection.
    const description = draft.description.trim();
    const amountCents = draft.amountCents;
    const payerId = draft.payerId;
    const participantIds = [...draft.participantIds];
    if (!description || description.length > 200 || !Number.isSafeInteger(amountCents) || amountCents <= 0
      || new Set(participantIds).size !== participantIds.length) {
      throw new Error('Invalid expense description, amount, or duplicate participants.');
    }
    const mates = await this.matesService.getMates();
    if (!this.isMateId(payerId, mates) || participantIds.some((id) => !this.isMateId(id, mates))) {
      throw new Error('Expected an existing payer and existing participant IDs.');
    }
    // The payer always participates, whether omitted from or already present in the selection.
    const shares = splitExpense(amountCents, [...new Set([payerId, ...participantIds])]);
    const reference = doc(collection(this.firebase.firestore, 'expenses'));
    await setDoc(reference, { description, amountCents, payerId, shares, createdAt: serverTimestamp() });
  }

  getExpenses(): Expense[] {
    const stored = localStorage.getItem(this.storageKey);
    if (stored === null) return [];
    const data: unknown = JSON.parse(stored);
    if (!Array.isArray(data)) throw new Error('Invalid local expense data.');
    const expenses = data.map((entry: unknown) => this.readExpense(entry));
    if (new Set(expenses.map((expense) => expense.id)).size !== expenses.length) {
      throw new Error('Duplicate local expense IDs.');
    }
    return expenses.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }

  saveExpense(draft: ExpenseDraft): Expense {
    const description = draft.description.trim();
    if (!description || description.length > 200 || !this.isMateId(draft.payerId)
      || draft.participantIds.some((id) => !this.isMateId(id))) {
      throw new Error('Invalid expense description, payer, or participants.');
    }
    const expense: Expense = {
      id: crypto.randomUUID(), description, amountCents: draft.amountCents,
      payerId: draft.payerId, shares: splitExpense(draft.amountCents, draft.participantIds),
      createdAt: new Date().toISOString(),
    };
    // Read before writing; malformed existing data must never be silently replaced.
    const expenses = this.getExpenses();
    localStorage.setItem(this.storageKey, JSON.stringify([expense, ...expenses]));
    return expense;
  }

  private isMateId(value: unknown, mates: readonly Mate[] = this.mates): value is string {
    return typeof value === 'string' && mates.some((mate) => mate.id === value);
  }

  private readFirestoreExpense(id: string, data: Record<string, unknown>, mates: readonly Mate[]): Expense {
    const { createdAt } = data;
    if (!(createdAt instanceof Timestamp)) {
      throw new Error(`Invalid expense document: expenses/${id}. Expected a createdAt timestamp.`);
    }
    const expense = this.readExpense({ ...data, id, createdAt: createdAt.toDate().toISOString() }, mates);
    if (!expense.shares.some((share) => share.mateId === expense.payerId)) {
      throw new Error(`Invalid expense document: expenses/${id}. The payer must participate in the split.`);
    }
    return expense;
  }

  private readExpense(value: unknown, mates: readonly Mate[] = this.mates): Expense {
    if (!value || typeof value !== 'object') throw new Error('Invalid local expense.');
    const data = value as Record<string, unknown>;
    const { id, description, amountCents, payerId, shares, createdAt } = data;
    if (typeof id !== 'string' || !id.trim() || typeof description !== 'string'
      || !description.trim() || description.length > 200 || typeof amountCents !== 'number'
      || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !this.isMateId(payerId, mates)
      || !Array.isArray(shares) || !shares.length || typeof createdAt !== 'string'
      || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
      throw new Error('Invalid local expense fields.');
    }
    const allocations: ExpenseShare[] = shares.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid expense share.');
      const { mateId, amountCents: shareCents } = entry as Record<string, unknown>;
      if (!this.isMateId(mateId, mates) || typeof shareCents !== 'number'
        || !Number.isSafeInteger(shareCents) || shareCents < 0) throw new Error('Invalid expense share.');
      return { mateId, amountCents: shareCents };
    });
    const expected = splitExpense(amountCents, allocations.map((share) => share.mateId));
    if (allocations.some((share) => expected.find((entry) => entry.mateId === share.mateId)?.amountCents !== share.amountCents)) {
      throw new Error('Invalid expense allocation.');
    }
    return { id, description: description.trim(), amountCents, payerId, shares: allocations, createdAt };
  }
}
