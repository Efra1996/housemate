import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { OnInit } from '@angular/core';
import { IonAvatar, IonButton, IonButtons, IonCard, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal, IonSkeletonText, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, basketOutline, chevronForwardOutline, closeOutline, timeOutline } from 'ionicons/icons';
import type { Expense } from '../interfaces/expense.interface';
import type { Mate } from '../interfaces/mate.interface';
import type { Reimbursement } from '../interfaces/reimbursement.interface';
import { ExpensesService } from '../services/expenses.service';
import { MatesService } from '../services/mates.service';
import { ReimbursementsService } from '../services/reimbursements.service';
import { ExpenseFormComponent } from './expense-form/expense-form.component';
import { formatExpenseAmount } from './expense-calculations';
import { ReimbursementFormComponent } from './reimbursement-form/reimbursement-form.component';

@Component({
  selector: 'app-expenses',
  templateUrl: 'expenses.page.html',
  styleUrls: ['expenses.page.scss'],
  imports: [NgTemplateOutlet, IonAvatar, IonButton, IonButtons, IonCard, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal, IonSkeletonText, IonText, IonTitle, IonToolbar, ExpenseFormComponent, ReimbursementFormComponent],
})
export class ExpensesPage implements OnInit {
  private readonly expensesService = inject(ExpensesService);
  private readonly matesService = inject(MatesService);
  private readonly reimbursementsService = inject(ReimbursementsService);
  readonly expenses = signal<Expense[]>([]);
  readonly reimbursements = signal<Reimbursement[]>([]);
  readonly mates = signal<Mate[]>([]);
  readonly loading = signal(false);
  readonly formOpen = signal(false);
  readonly historyOpen = signal(false);
  readonly reimbursementHistoryOpen = signal(false);
  readonly reimbursementSenderId = signal<string | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly formatAmount = formatExpenseAmount;
  readonly recentExpenses = computed(() => this.expenses().slice(0, 4));
  readonly reimbursementGroups = computed(() => {
    const groups = new Map<string, { key: string; label: string; reimbursements: {
      record: Reimbursement; senderName: string; recipientName: string; avatar: string; avatarClass: string; registeredLabel: string;
    }[] }>();
    const records = [...this.reimbursements()].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
    for (const record of records) {
      const date = new Date(record.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      let group = groups.get(key);
      if (!group) {
        const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(date);
        group = { key, label: label.charAt(0).toUpperCase() + label.slice(1), reimbursements: [] };
        groups.set(key, group);
      }
      const senderIndex = this.mates().findIndex((mate) => mate.id === record.fromMateId);
      group.reimbursements.push({
        record, senderName: this.mateName(record.fromMateId), recipientName: this.mateName(record.toMateId),
        avatar: this.mates()[senderIndex]?.avatar ?? '?',
        avatarClass: 'avatar avatar--' + (Math.max(0, senderIndex) % 5 + 1),
        registeredLabel: new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date),
      });
    }
    return [...groups.values()];
  });
  readonly expenseGroups = computed(() => {
    const groups = new Map<string, { key: string; label: string; expenses: Expense[] }>();
    for (const expense of this.expenses()) {
      const date = new Date(expense.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      let group = groups.get(key);
      if (!group) {
        const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(date);
        group = { key, label: label.charAt(0).toUpperCase() + label.slice(1), expenses: [] };
        groups.set(key, group);
      }
      group.expenses.push(expense);
    }
    return [...groups.values()];
  });
  readonly balances = computed(() => {
    const totals = new Map(this.mates().map((mate) => [mate.id, 0]));
    for (const expense of this.expenses()) {
      totals.set(expense.payerId, (totals.get(expense.payerId) ?? 0) + expense.amountCents);
      for (const share of expense.shares) {
        totals.set(share.mateId, (totals.get(share.mateId) ?? 0) - share.amountCents);
      }
    }
    for (const reimbursement of this.reimbursements()) {
      totals.set(reimbursement.fromMateId, (totals.get(reimbursement.fromMateId) ?? 0) + reimbursement.amountCents);
      totals.set(reimbursement.toMateId, (totals.get(reimbursement.toMateId) ?? 0) - reimbursement.amountCents);
    }
    return this.mates().map((mate) => {
      const amountCents = totals.get(mate.id) ?? 0;
      const sign = amountCents > 0 ? '+' : amountCents < 0 ? '−' : '';
      return {
        mate, amountCents,
        amountLabel: sign + formatExpenseAmount(Math.abs(amountCents)),
        status: amountCents > 0 ? 'receives' : amountCents < 0 ? 'owes' : 'settled',
        statusLabel: amountCents > 0 ? 'A su favor' : amountCents < 0 ? 'Debe' : 'Al día',
      };
    });
  });

  constructor() { addIcons({ addOutline, basketOutline, chevronForwardOutline, closeOutline, timeOutline }); }

  ngOnInit(): void { void this.loadData(); }
  ionViewWillEnter(): void { void this.loadData(); }

  async loadData(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const [expenses, mates, reimbursements] = await Promise.all([
        this.expensesService.getExpensesFromFirestore(), this.matesService.getMates(),
        this.reimbursementsService.getReimbursementsFromFirestore(),
      ]);
      this.expenses.set(expenses);
      this.mates.set(mates);
      this.reimbursements.set(reimbursements);
    } catch {
      this.expenses.set([]);
      this.mates.set([]);
      this.reimbursements.set([]);
      this.error.set('No se pudieron cargar los gastos, las devoluciones y los compañeros. Comprueba la conexión y vuelve a intentarlo.');
    } finally { this.loading.set(false); }
  }

  mateName(id: string): string {
    return this.mates().find((mate) => mate.id === id)?.nombre ?? 'Compañero';
  }

  participantsLabel(expense: Expense): string {
    return expense.shares.map((share) => this.mateName(share.mateId)).join(', ');
  }

  dateLabel(expense: Expense): string {
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(expense.createdAt));
  }

  shareLabel(expense: Expense): string {
    const amounts = expense.shares.map((share) => share.amountCents);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    return min === max ? formatExpenseAmount(min) : `${formatExpenseAmount(min)}–${formatExpenseAmount(max)}`;
  }

  onSaved(): void {
    this.formOpen.set(false);
    this.notice.set('Gasto guardado.');
    void this.loadData();
  }

  onReimbursementSaved(): void {
    this.reimbursementSenderId.set(null);
    this.notice.set('Devolución registrada.');
    void this.loadData();
  }
}
