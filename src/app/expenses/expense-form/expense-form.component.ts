import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { OnChanges, SimpleChanges } from '@angular/core';
import {
  IonAvatar, IonButton, IonButtons, IonCheckbox, IonContent, IonFooter,
  IonHeader, IonIcon, IonInput, IonItem, IonList, IonModal, IonSelect,
  IonSelectOption, IonSpinner, IonTextarea, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import type { Mate } from '../../interfaces/mate.interface';
import { ExpensesService } from '../../services/expenses.service';
import { filterAmountInput, formatExpenseAmount, parseExpenseAmount, splitExpense } from '../expense-calculations';

@Component({
  selector: 'app-expense-form',
  templateUrl: './expense-form.component.html',
  styleUrls: ['./expense-form.component.scss'],
  imports: [IonAvatar, IonButton, IonButtons, IonCheckbox, IonContent, IonFooter,
    IonHeader, IonIcon, IonInput, IonItem, IonList, IonModal, IonSelect,
    IonSelectOption, IonSpinner, IonTextarea, IonTitle, IonToolbar],
})
export class ExpenseFormComponent implements OnChanges {
  private readonly expensesService = inject(ExpensesService);
  readonly isOpen = input(false);
  readonly mates = input<readonly Mate[]>([]);
  readonly dismissed = output<void>();
  readonly saved = output<void>();
  readonly payerId = signal('');
  readonly description = signal('');
  readonly amount = signal('');
  readonly participantIds = signal<string[]>([]);
  readonly saving = signal(false);
  readonly error = signal('');
  private readonly confirmed = signal(false);
  readonly amountCents = computed(() => parseExpenseAmount(this.amount()));
  readonly availableParticipants = computed(() => this.mates().filter((mate) => mate.id !== this.payerId()));
  readonly allParticipantsSelected = computed(() => this.availableParticipants().length > 0
    && this.availableParticipants().every((mate) => this.participantIds().includes(mate.id)));
  readonly someParticipantsSelected = computed(() => !this.allParticipantsSelected()
    && this.availableParticipants().some((mate) => this.participantIds().includes(mate.id)));
  readonly validSelection = computed(() => this.mates().some((mate) => mate.id === this.payerId())
    && this.participantIds().length > 0
    && this.participantIds().every((id) => this.availableParticipants().some((mate) => mate.id === id)));
  readonly shares = computed(() => {
    const cents = this.amountCents();
    return cents !== null && this.validSelection()
      ? splitExpense(cents, [this.payerId(), ...this.participantIds()]) : [];
  });
  readonly hasRemainder = computed(() => {
    const shares = this.shares();
    return shares.length > 0 && shares.some((share) => share.amountCents !== shares[0].amountCents);
  });
  readonly canSave = computed(() => this.shares().length > 0 && !!this.description().trim()
    && this.description().trim().length <= 200 && !this.saving() && !this.confirmed());
  readonly formatAmount = formatExpenseAmount;

  constructor() { addIcons({ closeOutline }); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen()) {
      this.payerId.set(''); this.description.set(''); this.amount.set('');
      this.participantIds.set([]);
      this.error.set(''); this.confirmed.set(false);
    }
  }

  selectPayer(value: unknown): void {
    if (this.saving() || this.confirmed()) return;
    const id = typeof value === 'string' && this.mates().some((mate) => mate.id === value) ? value : '';
    this.payerId.set(id);
    this.participantIds.update((ids) => ids.filter((entry) => entry !== id));
  }

  setAmount(value: string, input?: IonInput): void {
    if (!this.saving() && !this.confirmed()) this.amount.set(filterAmountInput(value, this.amount()));
    if (input) input.value = this.amount();
  }

  changeParticipant(id: string, checked: boolean): void {
    if (this.saving() || this.confirmed()) return;
    if (!this.payerId() || !this.availableParticipants().some((mate) => mate.id === id)) return;
    this.participantIds.update((ids) => checked ? [...new Set([...ids, id])] : ids.filter((entry) => entry !== id));
  }

  toggleAllParticipants(checked: boolean): void {
    if (this.saving() || this.confirmed()) return;
    if (this.payerId()) this.participantIds.set(checked ? this.availableParticipants().map((mate) => mate.id) : []);
  }

  mateName(id: string): string {
    return this.mates().find((mate) => mate.id === id)?.nombre ?? 'Compañero';
  }

  close(): void { if (!this.saving()) this.dismissed.emit(); }

  async save(): Promise<void> {
    const amountCents = this.amountCents();
    if (!this.canSave() || amountCents === null) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.expensesService.saveExpenseToFirestore({
        description: this.description(), amountCents, payerId: this.payerId(), participantIds: [...this.participantIds()],
      });
    } catch {
      this.error.set('No se pudo confirmar el guardado. Comprueba la conexión y vuelve a intentarlo. Tus datos siguen en el formulario.');
      return;
    } finally { this.saving.set(false); }
    this.confirmed.set(true);
    this.saved.emit();
  }
}
