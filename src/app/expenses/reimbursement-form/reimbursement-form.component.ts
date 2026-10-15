import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { OnChanges, SimpleChanges } from '@angular/core';
import {
  IonAvatar, IonButton, IonButtons, IonContent, IonFooter,
  IonHeader, IonIcon, IonInput, IonList, IonModal, IonRadio,
  IonRadioGroup, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import type { Mate } from '../../interfaces/mate.interface';
import { ReimbursementsService } from '../../services/reimbursements.service';
import { filterAmountInput, formatExpenseAmount, parseExpenseAmount } from '../expense-calculations';

@Component({
  selector: 'app-reimbursement-form',
  templateUrl: './reimbursement-form.component.html',
  styleUrls: ['./reimbursement-form.component.scss'],
  imports: [IonAvatar, IonButton, IonButtons, IonContent, IonFooter,
    IonHeader, IonIcon, IonInput, IonList, IonModal, IonRadio,
    IonRadioGroup, IonSpinner, IonTitle, IonToolbar],
})
export class ReimbursementFormComponent implements OnChanges {
  private readonly reimbursementsService = inject(ReimbursementsService);
  readonly isOpen = input(false);
  readonly mates = input<readonly Mate[]>([]);
  readonly balances = input<readonly { mate: Mate; amountCents: number }[]>([]);
  readonly senderId = input<string | null>(null);
  readonly dismissed = output<void>();
  readonly saved = output<void>();
  readonly recipientId = signal('');
  readonly amount = signal('');
  readonly saving = signal(false);
  readonly error = signal('');
  private readonly confirmed = signal(false);
  private readonly refreshedDebtCents = signal<number | null>(null);
  private readonly refreshedCredits = signal<Record<string, number>>({});
  readonly sender = computed(() => this.balances().find((balance) => balance.mate.id === this.senderId()));
  readonly senderDebtCents = computed(() => this.refreshedDebtCents()
    ?? Math.max(0, -(this.sender()?.amountCents ?? 0)));
  readonly availableRecipients = computed(() => this.balances()
    .map((balance) => ({ mate: balance.mate, amountCents: this.refreshedCredits()[balance.mate.id] ?? balance.amountCents }))
    .filter((balance) => balance.mate.id !== this.senderId() && balance.amountCents > 0));
  readonly recipient = computed(() => this.availableRecipients().find((balance) => balance.mate.id === this.recipientId()));
  readonly amountCents = computed(() => parseExpenseAmount(this.amount()));
  readonly maximumCents = computed(() => Math.min(this.senderDebtCents(), this.recipient()?.amountCents ?? 0));
  readonly validAmount = computed(() => !!this.sender() && !!this.recipient()
    && this.amountCents() !== null && (this.amountCents() ?? 0) <= this.maximumCents());
  readonly canSave = computed(() => this.validAmount() && !this.saving() && !this.confirmed());
  readonly formatAmount = formatExpenseAmount;

  constructor() { addIcons({ closeOutline }); }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.isOpen() && (changes['isOpen'] || changes['senderId'])) {
      this.recipientId.set(''); this.amount.set('');
      this.error.set(''); this.confirmed.set(false); this.refreshedDebtCents.set(null);
      this.refreshedCredits.set({});
    }
  }

  selectRecipient(value: unknown): void {
    if (this.saving() || this.confirmed()) return;
    const id = typeof value === 'string' && this.availableRecipients().some((balance) => balance.mate.id === value) ? value : '';
    this.recipientId.set(id);
    this.amount.set(id ? (this.maximumCents() / 100).toFixed(2).replace('.', ',') : '');
    this.error.set('');
  }

  setAmount(value: string, input?: IonInput): void {
    if (!this.saving() && !this.confirmed()) {
      this.amount.set(filterAmountInput(value, this.amount()));
      this.error.set('');
    }
    if (input) input.value = this.amount();
  }

  formatBalance(cents: number): string {
    return (cents > 0 ? '+' : cents < 0 ? '−' : '') + formatExpenseAmount(Math.abs(cents));
  }

  balanceStatus(cents: number): string {
    return cents > 0 ? 'A su favor' : cents < 0 ? 'Debe' : 'Al día';
  }

  close(): void { if (!this.saving()) this.dismissed.emit(); }

  async save(): Promise<void> {
    const fromMateId = this.senderId();
    const amountCents = this.amountCents();
    if (!this.canSave() || fromMateId === null || amountCents === null) return;
    this.saving.set(true); this.error.set('');
    try {
      await this.reimbursementsService.saveReimbursementToFirestore({ fromMateId, toMateId: this.recipientId(), amountCents });
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'reimbursement-exceeds-debt'
        && 'debtCents' in error && typeof error.debtCents === 'number') {
        this.refreshedDebtCents.set(error.debtCents);
        this.error.set(`La deuda actual es de ${formatExpenseAmount(error.debtCents)}. Revisa el importe antes de registrar la devolución.`);
      } else if (error instanceof Error && 'code' in error && error.code === 'reimbursement-exceeds-credit'
        && 'toMateId' in error && typeof error.toMateId === 'string'
        && 'creditCents' in error && typeof error.creditCents === 'number'
        && 'debtCents' in error && typeof error.debtCents === 'number') {
        this.refreshedDebtCents.set(error.debtCents);
        const recipientId = error.toMateId;
        const creditCents = error.creditCents;
        this.refreshedCredits.update((credits) => ({ ...credits, [recipientId]: creditCents }));
        this.error.set(`El destinatario tiene ${formatExpenseAmount(creditCents)} a su favor. Revisa el destinatario y el importe.`);
      } else {
        this.error.set('No se pudo confirmar el registro. Comprueba la conexión y vuelve a intentarlo. Tus datos siguen en el formulario.');
      }
      return;
    } finally { this.saving.set(false); }
    this.confirmed.set(true);
    this.saved.emit();
  }
}
