import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { OnChanges, SimpleChanges } from '@angular/core';
import {
  IonAvatar, IonButton, IonButtons, IonCheckbox, IonContent, IonFooter,
  IonHeader, IonIcon, IonInput, IonItem, IonList, IonModal, IonSelect,
  IonSelectOption, IonTextarea, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import type { Expense } from '../../interfaces/expense.interface';
import { ExpensesService } from '../../services/expenses.service';
import { formatExpenseAmount, parseExpenseAmount, splitExpense } from '../expense-calculations';

@Component({
  selector: 'app-expense-form',
  templateUrl: './expense-form.component.html',
  styleUrls: ['./expense-form.component.scss'],
  imports: [IonAvatar, IonButton, IonButtons, IonCheckbox, IonContent, IonFooter,
    IonHeader, IonIcon, IonInput, IonItem, IonList, IonModal, IonSelect,
    IonSelectOption, IonTextarea, IonTitle, IonToolbar],
})
export class ExpenseFormComponent implements OnChanges {
  readonly isOpen = input(false);
  readonly dismissed = output<void>();
  readonly saved = output<Expense>();
  private readonly expensesService = inject(ExpensesService);
  readonly mates = this.expensesService.mates;
  readonly payerId = signal('');
  readonly description = signal('');
  readonly amount = signal('');
  readonly participantIds = signal<string[]>([]);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly confirmed = signal(false);
  readonly amountCents = computed(() => parseExpenseAmount(this.amount()));
  readonly shares = computed(() => {
    const cents = this.amountCents();
    return cents !== null && this.participantIds().length ? splitExpense(cents, this.participantIds()) : [];
  });
  readonly canSave = computed(() => this.amountCents() !== null && !!this.payerId()
    && !!this.description().trim() && this.description().trim().length <= 200
    && this.participantIds().length > 0 && !this.saving() && !this.confirmed());
  readonly preview = computed(() => {
    if (!this.participantIds().length) return 'Selecciona al menos un compañero';
    if (!this.shares().length) return 'Introduce un importe válido';
    const amounts = this.shares().map((share) => share.amountCents);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    return min === max ? `${formatExpenseAmount(min)} por persona`
      : `${formatExpenseAmount(min)}–${formatExpenseAmount(max)} por persona`;
  });
  readonly hasRemainder = computed(() => {
    const shares = this.shares();
    return shares.length > 0 && shares.some((share) => share.amountCents !== shares[0].amountCents);
  });
  readonly formatAmount = formatExpenseAmount;

  constructor() { addIcons({ closeOutline }); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen()) {
      this.payerId.set(''); this.description.set(''); this.amount.set('');
      this.participantIds.set([]); this.error.set(''); this.confirmed.set(false);
    }
  }

  selectPayer(value: unknown): void {
    this.payerId.set(typeof value === 'string' && this.mates.some((mate) => mate.id === value) ? value : '');
  }

  changeParticipant(id: string, checked: boolean): void {
    this.participantIds.update((ids) => checked ? [...new Set([...ids, id])] : ids.filter((entry) => entry !== id));
  }

  selectAll(): void { this.participantIds.set(this.mates.map((mate) => mate.id)); }

  close(): void { if (!this.saving()) this.dismissed.emit(); }

  save(): void {
    const amountCents = this.amountCents();
    if (!this.canSave() || amountCents === null) return;
    this.saving.set(true); this.error.set('');
    let expense: Expense;
    try {
      expense = this.expensesService.saveExpense({
        description: this.description(), amountCents, payerId: this.payerId(), participantIds: this.participantIds(),
      });
    } catch {
      this.error.set('No se pudo guardar en este navegador. Comprueba que el almacenamiento local esté disponible. Tus datos se mantienen en el formulario.');
      return;
    } finally { this.saving.set(false); }
    this.confirmed.set(true);
    this.saved.emit(expense);
  }
}
