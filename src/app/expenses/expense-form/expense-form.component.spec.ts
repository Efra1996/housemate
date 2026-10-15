import { NgTemplateOutlet } from '@angular/common';
import { Component, contentChild, input, output, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonModal } from '@ionic/angular';
import { ExpensesService } from '../../services/expenses.service';
import { ExpenseFormComponent } from './expense-form.component';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- Replaces the native overlay for input binding tests.
  selector: 'ion-modal', imports: [NgTemplateOutlet],
  template: '@if (isOpen()) { <ng-container [ngTemplateOutlet]="content() ?? null"></ng-container> }',
})
class TestModalComponent {
  readonly isOpen = input(false);
  readonly canDismiss = input(true);
  readonly didDismiss = output<void>();
  readonly content = contentChild<TemplateRef<unknown>>(TemplateRef);
}

describe('ExpenseFormComponent amount input', () => {
  let fixture: ComponentFixture<ExpenseFormComponent>;
  let component: ExpenseFormComponent;
  let input: HTMLIonInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpenseFormComponent],
      providers: [{ provide: ExpensesService, useValue: { saveExpenseToFirestore: vi.fn().mockResolvedValue(undefined) } }],
    }).overrideComponent(ExpenseFormComponent, {
      remove: { imports: [IonModal] }, add: { imports: [TestModalComponent] },
    }).compileComponents();
    fixture = TestBed.createComponent(ExpenseFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges(); await fixture.whenStable();
    input = (fixture.nativeElement as HTMLElement).querySelector('ion-input')!;
  });

  function enter(value: string): void {
    input.value = value;
    input.dispatchEvent(new CustomEvent('ionInput', { detail: { value } }));
    fixture.detectChanges();
  }

  it.each(['10', '10,', '10.', '10,25', '10.25', '0,01'])('accepts numeric entry %j', (value) => {
    enter(value);
    expect(component.amount()).toBe(value);
    expect(input.value).toBe(value);
  });

  it.each(['letters', '10a', '-10', '+10', '1e2', '10,256', '10.2.5', '10,2.5', '€10'])
    ('rejects typed or pasted %j and restores the visible amount', (value) => {
      enter('10,25'); enter(value);
      expect(component.amount()).toBe('10,25');
      expect(input.value).toBe('10,25');
    });

  it('allows clearing and retyping and rejects repeated invalid input', () => {
    enter('10'); enter('x'); enter('y');
    expect(input.value).toBe('10');
    enter(''); expect(component.amount()).toBe('');
    expect(component.amountCents()).toBeNull();
    enter('0'); expect(component.amountCents()).toBeNull();
    enter('0,50'); expect(component.amountCents()).toBe(50);
  });

  it('does not accept changes while saving', () => {
    enter('10'); component.saving.set(true); enter('20');
    expect(component.amount()).toBe('10');
    expect(input.value).toBe('10');
  });
});
