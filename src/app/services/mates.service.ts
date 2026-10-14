import { Injectable, inject } from '@angular/core';
import { collection, getDocsFromServer } from 'firebase/firestore';
import type { Mate } from '../interfaces/mate.interface';
import { FirebaseService } from './firebase.service';

@Injectable({ providedIn: 'root' })
export class MatesService {
  private readonly firebase = inject(FirebaseService);

  async getMates(): Promise<Mate[]> {
    const snapshot = await getDocsFromServer(collection(this.firebase.firestore, 'mates'));

    return snapshot.docs
      .map((document) => this.toMate(document.id, document.data()))
      .sort((first, second) => first.id.localeCompare(second.id, 'en', { numeric: true }));
  }

  private toMate(id: string, data: Record<string, unknown>): Mate {
    const { nombre, avatar } = data;
    if (typeof nombre !== 'string' || !nombre.trim()
      || typeof avatar !== 'string' || !avatar.trim()) {
      throw new Error(`Invalid mate document: mates/${id}. Expected non-empty nombre and avatar strings.`);
    }

    return { id, nombre: nombre.trim(), avatar: avatar.trim() };
  }
}
