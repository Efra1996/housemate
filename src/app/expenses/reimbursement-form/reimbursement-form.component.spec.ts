import { NgTemplateOutlet } from '@angular/common';
import { Component, contentChild, input, output, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonModal } from '@ionic/angular';
import { ReimbursementsService } from '../../services/reimbursements.service';
import { formatExpenseAmount } from '../expense-calculations';
import { ReimbursementFormComponent } from './reimbursement-form.component';

// Exercise bindings without relying on native Ionic overlay animation in jsdom.
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- Must replace Ionic's selector in this test.
  selector: 'ion-modal', imports: [NgTemplateOutlet],
  template: '@if (isOpen()) { <ng-container [ngTemplateOutlet]="content() ?? null"></ng-container> }',
})
class TestModalComponent {
  readonly isOpen = input(false);
  readonly canDismiss = input(true);
  readonly didDismiss = output<void>();
  readonly content = contentChild<TemplateRef<unknown>>(TemplateRef);
}

const mates = [
  { id: 'debtor', nombre: 'David', avatar: 'DA' },
  { id: 'creditor', nombre: 'Efra', avatar: 'EF' },
  { id: 'small-creditor', nombre: 'Ainara', avatar: 'AI' },
  { id: 'settled', nombre: 'Izaro', avatar: 'IZ' },
  { id: 'other-debtor', nombre: 'Marcela', avatar: 'MA' },
];
const balances = mates.map((mate, index) => ({ mate, amountCents: [-2000, 3000, 500, 0, -1500][index] }));

describe('ReimbursementFormComponent', () => {
  let fixture: ComponentFixture<ReimbursementFormComponent>;
  let component: ReimbursementFormComponent;
  let root: HTMLElement;
  let save: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    save = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [ReimbursementFormComponent],
      providers: [{ provide: ReimbursementsService, useValue: { saveReimbursementToFirestore: save } }],
    }).overrideComponent(ReimbursementFormComponent, {
      remove: { imports: [IonModal] }, add: { imports: [TestModalComponent] },
    }).compileComponents();
    fixture = TestBed.createComponent(ReimbursementFormComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('mates', mates);
    fixture.componentRef.setInput('balances', balances);
    fixture.componentRef.setInput('senderId', 'debtor');
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('fixes the sender and lists only positive-balance recipients', () => {
    expect(component.sender()?.mate.nombre).toBe('David');
    expect(component.availableRecipients().map((entry) => entry.mate.id)).toEqual(['creditor', 'small-creditor']);
    expect(root.querySelectorAll('ion-radio')).toHaveLength(2);
    expect(root.querySelector('ion-select')).toBeNull();
    expect(component.canSave()).toBe(false);
  });

  it('fills the smaller of sender debt and recipient credit and keeps partial amounts editable', () => {
    component.selectRecipient('creditor');
    expect(component.amount()).toBe('20,00');
    expect(component.maximumCents()).toBe(2000);
    component.setAmount('1,25');
    expect(component.canSave()).toBe(true);
    component.selectRecipient('small-creditor');
    expect(component.amount()).toBe('5,00');
    expect(component.maximumCents()).toBe(500);
    component.selectRecipient('creditor');
    expect(component.amount()).toBe('20,00');
  });

  it('handles radio and input events and shows the resulting balance preview', () => {
    root.querySelector('ion-radio-group')?.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'small-creditor' } }));
    fixture.detectChanges();
    expect(component.amount()).toBe('5,00');
    root.querySelector('ion-input')?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '2,50' } }));
    fixture.detectChanges();
    expect(component.amountCents()).toBe(250);
    const preview = root.querySelector('.preview');
    expect(preview?.textContent).toContain('−' + formatExpenseAmount(1750));
    expect(preview?.textContent).toContain('+' + formatExpenseAmount(250));
    expect(preview?.textContent).toContain('Debe');
    component.setAmount('5'); fixture.detectChanges();
    expect(root.querySelector('.preview')?.textContent).toContain('Al día');
  });

  it.each(['', '0', '-1', '1,234', 'NaN', '20,01'])('blocks invalid or excessive amount %j', async (amount) => {
    component.selectRecipient('creditor'); component.amount.set(amount);
    expect(component.canSave()).toBe(false);
    await component.save();
    expect(save).not.toHaveBeenCalled();
  });

  it('blocks amounts above the recipient credit and displays the limit', () => {
    component.selectRecipient('small-creditor'); component.setAmount('5,01'); fixture.detectChanges();
    expect(component.canSave()).toBe(false);
    expect(root.querySelector('.error-message')?.textContent).toContain(formatExpenseAmount(500));
  });

  it('rejects invalid input and restores the visible value even when the signal has not changed', () => {
    component.selectRecipient('creditor'); fixture.detectChanges();
    const input = root.querySelector('ion-input')!;
    for (const value of ['20a', '-20', '1e2', '2,345', '1,2.3']) {
      input.value = value;
      input.dispatchEvent(new CustomEvent('ionInput', { detail: { value } }));
      expect(component.amount()).toBe('20,00');
      expect(input.value).toBe('20,00');
    }
    input.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '' } }));
    expect(component.amount()).toBe('');
    expect(component.canSave()).toBe(false);
  });

  it.each(['debtor', 'settled', 'other-debtor', 'missing', null, 42])('rejects invalid recipient %j', (recipient) => {
    component.selectRecipient('creditor'); component.selectRecipient(recipient);
    expect(component.recipientId()).toBe('');
    expect(component.amount()).toBe('');
    expect(component.canSave()).toBe(false);
  });

  it('saves a single repayment in integer cents and emits success only once', async () => {
    const saved = vi.fn(); component.saved.subscribe(saved);
    component.selectRecipient('small-creditor'); component.setAmount('1,25');
    await component.save(); await component.save();
    expect(save).toHaveBeenCalledExactlyOnceWith({ fromMateId: 'debtor', toMateId: 'small-creditor', amountCents: 125 });
    expect(saved).toHaveBeenCalledOnce();
    expect(component.saving()).toBe(false);
    expect(component.canSave()).toBe(false);
  });

  it('prevents duplicate requests, editing, and dismissal during save', async () => {
    let resolve!: () => void;
    save.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const dismissed = vi.fn(); component.dismissed.subscribe(dismissed);
    component.selectRecipient('creditor');
    const pending = component.save();
    component.selectRecipient('small-creditor'); component.setAmount('1'); component.close();
    await component.save();
    expect(component.saving()).toBe(true);
    expect(component.recipientId()).toBe('creditor');
    expect(component.amount()).toBe('20,00');
    expect(save).toHaveBeenCalledOnce();
    expect(dismissed).not.toHaveBeenCalled();
    resolve(); await pending;
  });

  it('preserves values on network failure and allows retry', async () => {
    save.mockRejectedValueOnce(new Error('offline'));
    const saved = vi.fn(); component.saved.subscribe(saved);
    component.selectRecipient('creditor'); component.setAmount('2,50');
    await component.save(); fixture.detectChanges();
    expect(saved).not.toHaveBeenCalled();
    expect(component.amount()).toBe('2,50');
    expect(component.recipientId()).toBe('creditor');
    expect(component.saving()).toBe(false);
    expect(root.textContent).toContain('No se pudo confirmar');
    await component.save();
    expect(saved).toHaveBeenCalledOnce();
    expect(component.error()).toBe('');
  });

  it('refreshes the sender limit after a stale-debt rejection', async () => {
    save.mockRejectedValueOnce(Object.assign(new Error('stale debt'), { code: 'reimbursement-exceeds-debt', debtCents: 300 }));
    component.selectRecipient('creditor'); await component.save();
    expect(component.senderDebtCents()).toBe(300);
    expect(component.maximumCents()).toBe(300);
    expect(component.canSave()).toBe(false);
    expect(component.error()).toContain(formatExpenseAmount(300));
    component.setAmount('3');
    expect(component.canSave()).toBe(true);
  });

  it.each([200, 0])('refreshes recipient credit to %s after server rejection', async (creditCents) => {
    save.mockRejectedValueOnce(Object.assign(new Error('stale credit'), {
      code: 'reimbursement-exceeds-credit', toMateId: 'small-creditor', creditCents, debtCents: 1500,
    }));
    component.selectRecipient('small-creditor'); await component.save();
    expect(component.senderDebtCents()).toBe(1500);
    expect(component.maximumCents()).toBe(creditCents);
    expect(component.canSave()).toBe(false);
    expect(component.error()).toContain(formatExpenseAmount(creditCents));
    if (creditCents === 0) expect(component.availableRecipients().map((entry) => entry.mate.id)).not.toContain('small-creditor');
    else { component.selectRecipient('small-creditor'); expect(component.amount()).toBe('2,00'); }
  });

  it('resets selection, amount, errors, and server overrides when reopened', async () => {
    save.mockRejectedValueOnce(Object.assign(new Error('stale debt'), { code: 'reimbursement-exceeds-debt', debtCents: 0 }));
    component.selectRecipient('creditor'); await component.save();
    fixture.componentRef.setInput('isOpen', false); fixture.detectChanges();
    fixture.componentRef.setInput('isOpen', true); fixture.detectChanges();
    expect(component.recipientId()).toBe(''); expect(component.amount()).toBe('');
    expect(component.error()).toBe(''); expect(component.senderDebtCents()).toBe(2000);
    component.selectRecipient('creditor');
    expect(component.canSave()).toBe(true);
  });

  it('resets when changing sender and blocks absent or settled senders', () => {
    component.selectRecipient('creditor');
    fixture.componentRef.setInput('senderId', 'settled'); fixture.detectChanges();
    expect(component.amount()).toBe('');
    component.selectRecipient('creditor');
    expect(component.canSave()).toBe(false);
    fixture.componentRef.setInput('senderId', null); fixture.detectChanges();
    expect(root.textContent).toContain('vuelve a cargar los saldos');
    expect(component.canSave()).toBe(false);
  });

  it('shows no eligible recipients and emits dismissal when idle', () => {
    fixture.componentRef.setInput('balances', [{ mate: mates[0], amountCents: -2000 }]); fixture.detectChanges();
    expect(root.textContent).toContain('No hay compañeros con saldo a su favor.');
    const dismissed = vi.fn(); component.dismissed.subscribe(dismissed);
    component.close(); expect(dismissed).toHaveBeenCalledOnce();
  });

  it('formats positive, negative, and settled balances', () => {
    expect(component.formatBalance(100)).toBe('+' + formatExpenseAmount(100));
    expect(component.formatBalance(-100)).toBe('−' + formatExpenseAmount(100));
    expect(component.formatBalance(0)).toBe(formatExpenseAmount(0));
    expect([100, -100, 0].map((amount) => component.balanceStatus(amount))).toEqual(['A su favor', 'Debe', 'Al día']);
  });
});
