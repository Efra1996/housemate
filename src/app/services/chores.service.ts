import { Injectable, inject } from '@angular/core';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import type { Chore } from '../interfaces/chore.interface';
import { FirebaseService } from './firebase.service';

@Injectable({ providedIn: 'root' })
export class ChoresService {
  private readonly firebase = inject(FirebaseService);

  async getActiveChores(): Promise<Chore[]> {
    const snapshot = await getDocsFromServer(query(
      collection(this.firebase.firestore, 'chores'),
      where('active', '==', true),
    ));

    return snapshot.docs
      .map((document) => this.toChore(document.id, document.data()))
      .sort((first, second) => first.id.localeCompare(second.id));
  }

  private toChore(id: string, data: Record<string, unknown>): Chore {
    const { title, eligibleMateIds, active } = data;
    if (typeof title !== 'string' || !title.trim()
      || !this.isMateIdList(eligibleMateIds) || typeof active !== 'boolean') {
      throw new Error(`Invalid chore document: chores/${id}. Expected a title string, an eligibleMateIds string array, and an active boolean.`);
    }

    return { id, title: title.trim(), eligibleMateIds: eligibleMateIds.map((mateId) => mateId.trim()), active };
  }

  private isMateIdList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((mateId: unknown) => typeof mateId === 'string' && mateId.trim().length > 0);
  }
}
