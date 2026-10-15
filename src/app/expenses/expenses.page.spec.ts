import { NgTemplateOutlet } from '@angular/common';
import { Component, contentChild, input, output, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { IonModal } from '@ionic/angular';
import type { Expense } from '../interfaces/expense.interface';
import type { Reimbursement } from '../interfaces/reimbursement.interface';
import { ExpensesService } from '../services/expenses.service';
import { MatesService } from '../services/mates.service';
import { ReimbursementsService } from '../services/reimbursements.service';
import { ExpenseFormComponent } from './expense-form/expense-form.component';
import { ReimbursementFormComponent } from './reimbursement-form/reimbursement-form.component';
import { formatExpenseAmount } from './expense-calculations';
import { ExpensesPage } from './expenses.page';

// Render modal content synchronously; native overlay behavior needs browser tests.
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- Must replace Ionic's selector in this test.
  selector: 'ion-modal',
  imports: [NgTemplateOutlet],
  template: '@if (isOpen()) { <ng-container [ngTemplateOutlet]="content() ?? null"></ng-container> }',
})
class TestModalComponent {
  readonly isOpen = input(false);
  readonly didDismiss = output<void>();
  readonly content = contentChild<TemplateRef<unknown>>(TemplateRef);
}

const mates = [
  { id: 'a', nombre: 'Efra', avatar: 'EF' },
  { id: 'b', nombre: 'David', avatar: 'DA' },
  { id: 'c', nombre: 'Ainara', avatar: 'AI' },
];
const expense = (id: string, createdAt = '2026-10-15T12:00:00.000Z'): Expense => ({
  id, description: 'Expense ' + id, amountCents: 3000, payerId: 'a', createdAt,
  shares: mates.map((mate) => ({ mateId: mate.id, amountCents: 1000 })),
});
const reimbursement = (id: string, createdAt = '2026-10-15T12:00:00.000Z'): Reimbursement => ({
  id, fromMateId: 'b', toMateId: 'a', amountCents: 500, createdAt,
});

describe('ExpensesPage', () => {
  let fixture: ComponentFixture<ExpensesPage>;
  let component: ExpensesPage;
  let root: HTMLElement;
  let expensesService: { getExpensesFromFirestore: ReturnType<typeof vi.fn> };
  let matesService: { getMates: ReturnType<typeof vi.fn> };
  let reimbursementsService: { getReimbursementsFromFirestore: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    expensesService = { getExpensesFromFirestore: vi.fn().mockResolvedValue([expense('1')]) };
    matesService = { getMates: vi.fn().mockResolvedValue(mates) };
    reimbursementsService = { getReimbursementsFromFirestore: vi.fn().mockResolvedValue([]) };
    await TestBed.configureTestingModule({
      imports: [ExpensesPage],
      providers: [
        { provide: ExpensesService, useValue: expensesService },
        { provide: MatesService, useValue: matesService },
        { provide: ReimbursementsService, useValue: reimbursementsService },
      ],
    }).overrideComponent(ExpensesPage, {
      remove: { imports: [IonModal] }, add: { imports: [TestModalComponent] },
    }).overrideComponent(ExpenseFormComponent, { set: { template: '', imports: [] } })
      .overrideComponent(ReimbursementFormComponent, { set: { template: '', imports: [] } }).compileComponents();
    fixture = TestBed.createComponent(ExpensesPage);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.loading()).toBe(false));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  function click(selector: string): void {
    const button = root.querySelector<HTMLElement>(selector);
    expect(button).not.toBeNull();
    button?.click();
    fixture.detectChanges();
  }

  it('loads all three mocked services and renders expenses before balances', () => {
    expect(expensesService.getExpensesFromFirestore).toHaveBeenCalledOnce();
    expect(matesService.getMates).toHaveBeenCalledOnce();
    expect(reimbursementsService.getReimbursementsFromFirestore).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('Expense 1');
    expect(root.textContent?.indexOf('Últimos gastos')).toBeLessThan(root.textContent?.indexOf('Saldos') ?? 0);
  });

  it('limits the preview to four without excluding older expenses from balances', () => {
    component.expenses.set(['5', '4', '3', '2', '1'].map((id) => expense(id)));
    fixture.detectChanges();
    expect(component.recentExpenses().map((entry) => entry.id)).toEqual(['5', '4', '3', '2']);
    expect(root.querySelectorAll('.record-list .record')).toHaveLength(4);
    expect(root.textContent).not.toContain('Expense 1');
    expect(component.balances().map((balance) => balance.amountCents)).toEqual([10000, -5000, -5000]);
    expect(root.textContent).toContain('4 de 5');
  });

  it('opens the full expense history, groups by month, and closes it', () => {
    component.expenses.set([
      expense('5'), expense('4'), expense('3'), expense('2'), expense('1', '2026-09-12T12:00:00.000Z'),
    ]);
    fixture.detectChanges();
    click('ion-button.show-all');
    expect(component.historyOpen()).toBe(true);
    const modal = root.querySelector('ion-modal')!;
    expect(modal.textContent).toContain('Expense 1');
    expect(modal.textContent).toContain('Octubre de 2026');
    expect(modal.textContent).toContain('Septiembre de 2026');
    expect(modal.querySelectorAll('.record')).toHaveLength(5);
    click('[aria-label="Cerrar historial"]');
    expect(component.historyOpen()).toBe(false);
  });

  it('derives balances from expenses and repayments, conserving the total', () => {
    component.reimbursements.set([reimbursement('r')]);
    expect(component.balances().map((balance) => balance.amountCents)).toEqual([1500, -500, -1000]);
    expect(component.balances().reduce((sum, balance) => sum + balance.amountCents, 0)).toBe(0);
    expect(component.balances().map((balance) => balance.statusLabel)).toEqual(['A su favor', 'Debe', 'Debe']);
    component.reimbursements.set([{ ...reimbursement('r'), amountCents: 1000 }]);
    expect(component.balances()[1].statusLabel).toBe('Al día');
  });

  it('offers repayment only on debtor cards and passes the selected sender', () => {
    expect(root.querySelectorAll('.reimbursement-button')).toHaveLength(2);
    expect(root.querySelector('.reimbursement-button')?.closest('.balance-card')?.textContent).toContain('David');
    click('.reimbursement-button');
    expect(component.reimbursementSenderId()).toBe('b');
    const form = fixture.debugElement.query(By.directive(ReimbursementFormComponent)).componentInstance as ReimbursementFormComponent;
    expect(form.senderId()).toBe('b');
    expect(form.isOpen()).toBe(true);
    form.dismissed.emit();
    expect(component.reimbursementSenderId()).toBeNull();
  });

  it('renders empty expenses and settled balances', () => {
    component.expenses.set([]);
    fixture.detectChanges();
    expect(root.textContent).toContain('Todavía no hay gastos');
    expect(root.querySelectorAll('.reimbursement-button')).toHaveLength(0);
    expect(component.balances().every((balance) => balance.statusLabel === 'Al día')).toBe(true);
    component.mates.set([]);
    fixture.detectChanges();
    expect(root.textContent).toContain('No hay compañeros registrados');
  });

  it('shows loading and ignores overlapping reload requests', async () => {
    let resolve!: (records: Expense[]) => void;
    expensesService.getExpensesFromFirestore.mockReturnValue(new Promise<Expense[]>((done) => { resolve = done; }));
    const pending = component.loadData();
    await component.loadData();
    fixture.detectChanges();
    expect(component.loading()).toBe(true);
    expect(expensesService.getExpensesFromFirestore).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[aria-labelledby="expenses-title"]')?.getAttribute('aria-busy')).toBe('true');
    resolve([]);
    await pending;
    expect(component.loading()).toBe(false);
  });

  it('clears stale data after failure and supports retry', async () => {
    expensesService.getExpensesFromFirestore.mockRejectedValueOnce(new Error('offline'));
    await component.loadData(); fixture.detectChanges();
    expect(component.expenses()).toEqual([]);
    expect(component.reimbursements()).toEqual([]);
    expect(component.mates()).toEqual([]);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
    click('[role="alert"] ion-button');
    await vi.waitFor(() => expect(component.loading()).toBe(false));
    await fixture.whenStable(); fixture.detectChanges();
    expect(component.error()).toBe('');
    expect(root.textContent).toContain('Expense 1');
  });

  it('opens reimbursement history with all records sorted and grouped, showing people and amounts', () => {
    component.reimbursements.set([
      reimbursement('old', '2026-09-21T12:00:00.000Z'),
      { ...reimbursement('new'), amountCents: 750 },
      reimbursement('middle', '2026-10-01T12:00:00.000Z'),
    ]);
    fixture.detectChanges();
    click('.balances-section .show-all');
    const modal = root.querySelectorAll('ion-modal')[1];
    expect(component.reimbursementGroups().map((group) => group.reimbursements.map((entry) => entry.record.id)))
      .toEqual([['new', 'middle'], ['old']]);
    expect(modal.querySelectorAll('ion-item')).toHaveLength(3);
    expect(modal.textContent).toContain('David');
    expect(modal.textContent).toContain('Efra');
    expect(modal.textContent).toContain(formatExpenseAmount(750));
    expect(modal.textContent).toContain('Registrado el');
    expect(modal.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-15T12:00:00.000Z');
    expect(modal.textContent).toContain('Septiembre de 2026');
    click('[aria-label="Cerrar historial de devoluciones"]');
    expect(component.reimbursementHistoryOpen()).toBe(false);
  });

  it('opens an empty reimbursement history and handles dismissal', () => {
    click('.balances-section .show-all');
    expect(root.textContent).toContain('Todavía no hay devoluciones registradas.');
    const modal = fixture.debugElement.queryAll(By.directive(TestModalComponent))[1].componentInstance as TestModalComponent;
    modal.didDismiss.emit(); fixture.detectChanges();
    expect(component.reimbursementHistoryOpen()).toBe(false);
  });

  it('renders loading and error states inside an open reimbursement history', () => {
    component.reimbursementHistoryOpen.set(true);
    component.loading.set(true); fixture.detectChanges();
    expect(root.querySelector('[aria-label="Cargando devoluciones"]')).not.toBeNull();
    component.loading.set(false); component.error.set('Sin conexión'); fixture.detectChanges();
    expect(root.querySelectorAll('ion-modal')[1].textContent).toContain('Sin conexión');
  });

  it('reloads and closes the form after a saved expense or reimbursement', async () => {
    component.formOpen.set(true); component.onSaved();
    await vi.waitFor(() => expect(component.loading()).toBe(false));
    await fixture.whenStable();
    expect(component.formOpen()).toBe(false);
    expect(component.notice()).toBe('Gasto guardado.');
    component.reimbursementSenderId.set('b'); component.onReimbursementSaved();
    await vi.waitFor(() => expect(component.loading()).toBe(false));
    await fixture.whenStable();
    expect(component.reimbursementSenderId()).toBeNull();
    expect(component.notice()).toBe('Devolución registrada.');
    expect(reimbursementsService.getReimbursementsFromFirestore).toHaveBeenCalledTimes(3);
  });

  it('formats uneven shares and handles unknown member names', () => {
    expect(component.mateName('missing')).toBe('Compañero');
    const record = expense('uneven'); record.shares[0].amountCents += 1;
    expect(component.shareLabel(record)).toBe(formatExpenseAmount(1000) + '–' + formatExpenseAmount(1001));
    expect(component.participantsLabel(record)).toBe('Efra, David, Ainara');
  });
});
