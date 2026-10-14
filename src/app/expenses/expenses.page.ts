import { Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { IonButton, IonCard, IonContent, IonIcon, IonItem, IonLabel, IonList, IonText } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, receiptOutline } from 'ionicons/icons';
import type { Expense } from '../interfaces/expense.interface';
import { ExpensesService } from '../services/expenses.service';
import { ExpenseFormComponent } from './expense-form/expense-form.component';
import { formatExpenseAmount } from './expense-calculations';

@Component({
  selector: 'app-expenses',
  templateUrl: 'expenses.page.html',
  styleUrls: ['expenses.page.scss'],
  imports: [IonButton, IonCard, IonContent, IonIcon, IonItem, IonLabel, IonList, IonText, ExpenseFormComponent],
})
export class ExpensesPage implements OnInit {
  private readonly expensesService = inject(ExpensesService);
  readonly expenses = signal<Expense[]>([]);
  readonly formOpen = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly formatAmount = formatExpenseAmount;

  constructor() { addIcons({ addOutline, receiptOutline }); }

  ngOnInit(): void { this.loadData(); }
  ionViewWillEnter(): void { this.loadData(); }

  loadData(): void {
    this.error.set('');
    try { this.expenses.set(this.expensesService.getExpenses()); }
    catch {
      this.expenses.set([]);
      this.error.set('No se pudieron leer los gastos de este navegador. El almacenamiento puede estar bloqueado o los datos no ser válidos. No se ha borrado ningún gasto.');
    }
  }

  mateName(id: string): string {
    return this.expensesService.mates.find((mate) => mate.id === id)?.nombre ?? 'Compañero';
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

  onSaved(expense: Expense): void {
    this.expenses.update((expenses) => [expense, ...expenses.filter((entry) => entry.id !== expense.id)]);
    this.formOpen.set(false);
    this.notice.set('Gasto guardado en este navegador.');
  }
}
