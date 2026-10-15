import { Injectable, inject } from '@angular/core';
import { Timestamp, collection, doc, getDocsFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { Mate } from '../interfaces/mate.interface';
import type { Reimbursement, ReimbursementBatchDraft, ReimbursementDraft } from '../interfaces/reimbursement.interface';
import { ExpensesService } from './expenses.service';
import { FirebaseService } from './firebase.service';
import { MatesService } from './mates.service';

@Injectable({ providedIn: 'root' })
export class ReimbursementsService {
  private readonly firebase = inject(FirebaseService);
  private readonly matesService = inject(MatesService);
  private readonly expensesService = inject(ExpensesService);

  async getReimbursementsFromFirestore(): Promise<Reimbursement[]> {
    const [snapshot, mates] = await Promise.all([
      getDocsFromServer(collection(this.firebase.firestore, 'reimbursements')),
      this.matesService.getMates(),
    ]);
    return snapshot.docs.map((document) => this.toReimbursement(document.id, document.data(), mates))
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }

  async saveReimbursementToFirestore(draft: ReimbursementDraft): Promise<void> {
    const { fromMateId, toMateId, amountCents } = draft;
    await this.saveReimbursementsToFirestore({ fromMateId, recipients: [{ toMateId, amountCents }] });
  }

  async saveReimbursementsToFirestore(draft: ReimbursementBatchDraft): Promise<void> {
    // Capture the complete group before asynchronous reads.
    const fromMateId = draft.fromMateId;
    const recipients = draft.recipients.map((recipient) => ({ ...recipient }));
    if (!recipients.length || recipients.length > 500
      || new Set(recipients.map((recipient) => recipient.toMateId)).size !== recipients.length
      || recipients.some((recipient) => recipient.toMateId === fromMateId
        || !Number.isSafeInteger(recipient.amountCents) || recipient.amountCents <= 0)) {
      throw new Error('Expected unique, different recipients and positive integer cents.');
    }
    const totalCents = recipients.reduce((total, recipient) => total + recipient.amountCents, 0);
    if (!Number.isSafeInteger(totalCents)) throw new Error('Reimbursement total exceeds safe integer cents.');

    const [mates, expenses, reimbursements] = await Promise.all([
      this.matesService.getMates(), this.expensesService.getExpensesFromFirestore(),
      this.getReimbursementsFromFirestore(),
    ]);
    if (!this.isMateId(fromMateId, mates) || recipients.some((recipient) => !this.isMateId(recipient.toMateId, mates))) {
      throw new Error('Expected existing sender and recipient IDs.');
    }
    const balances = new Map(mates.map((mate) => [mate.id, 0]));
    const adjustBalance = (mateId: string, amountCents: number): void => {
      const balance = (balances.get(mateId) ?? 0) + amountCents;
      if (!Number.isSafeInteger(balance)) throw new Error('Member balance exceeds safe integer cents.');
      balances.set(mateId, balance);
    };
    for (const expense of expenses) {
      adjustBalance(expense.payerId, expense.amountCents);
      for (const share of expense.shares) adjustBalance(share.mateId, -share.amountCents);
    }
    for (const reimbursement of reimbursements) {
      adjustBalance(reimbursement.fromMateId, reimbursement.amountCents);
      adjustBalance(reimbursement.toMateId, -reimbursement.amountCents);
    }
    const debtCents = Math.max(0, -(balances.get(fromMateId) ?? 0));
    if (totalCents > debtCents) {
      throw Object.assign(new Error('Reimbursement total exceeds the sender outstanding debt.'), {
        code: 'reimbursement-exceeds-debt', debtCents,
      });
    }
    for (const recipient of recipients) {
      const creditCents = Math.max(0, balances.get(recipient.toMateId) ?? 0);
      if (recipient.amountCents > creditCents) {
        throw Object.assign(new Error('Reimbursement exceeds the recipient positive balance.'), {
          code: 'reimbursement-exceeds-credit', toMateId: recipient.toMateId, creditCents, debtCents,
        });
      }
    }
    // The writes are atomic; the preceding collection reads are not a cross-device lock.
    const batch = writeBatch(this.firebase.firestore);
    const reimbursementsCollection = collection(this.firebase.firestore, 'reimbursements');
    for (const recipient of recipients) {
      batch.set(doc(reimbursementsCollection), { fromMateId, ...recipient, createdAt: serverTimestamp() });
    }
    await batch.commit();
  }

  private isMateId(value: unknown, mates: readonly Mate[]): value is string {
    return typeof value === 'string' && mates.some((mate) => mate.id === value);
  }

  private toReimbursement(id: string, data: Record<string, unknown>, mates: readonly Mate[]): Reimbursement {
    const { fromMateId, toMateId, amountCents, createdAt } = data;
    if (!this.isMateId(fromMateId, mates) || !this.isMateId(toMateId, mates) || fromMateId === toMateId
      || typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents <= 0
      || !(createdAt instanceof Timestamp)) {
      throw new Error(`Invalid reimbursement document: reimbursements/${id}. Expected existing, different member IDs, positive integer cents, and a createdAt timestamp.`);
    }
    return { id, fromMateId, toMateId, amountCents, createdAt: createdAt.toDate().toISOString() };
  }
}
