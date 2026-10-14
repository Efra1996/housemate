import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CalendarPage } from './calendar.page';
import { TasksService } from '../services/tasks.service';
import { MatesService } from '../services/mates.service';
import { vi } from 'vitest';

describe('CalendarPage', () => {
  let component: CalendarPage;
  let fixture: ComponentFixture<CalendarPage>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(CalendarPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('CalendarPage after weekly saving', () => {
  let page: CalendarPage;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      { provide: TasksService, useValue: { getTasksForDateRange: vi.fn().mockResolvedValue([]) } },
      { provide: MatesService, useValue: { getMates: vi.fn().mockResolvedValue([]) } },
    ] });
    page = TestBed.createComponent(CalendarPage).componentInstance;
  });

  it('closes the organizer and reloads the saved date, even in another month', async () => {
    page.organizerOpen.set(true);
    const reload = vi.spyOn(page, 'loadData').mockResolvedValue(undefined);
    await page.onWeekSaved({ weekStart: '2026-11-02', firstDeadline: '2026-11-08' });
    expect(page.organizerOpen()).toBe(false);
    expect(page.selectedDate()).toBe('2026-11-08');
    expect(reload).toHaveBeenCalledOnce();
    expect(page.saveNotice()).toBe('Semana guardada correctamente.');
  });

  it('distinguishes a confirmed save from a failed refresh', async () => {
    vi.spyOn(page, 'loadData').mockImplementation(async () => { page.error.set('Offline'); });
    await page.onWeekSaved({ weekStart: '2026-10-12', firstDeadline: '2026-10-18' });
    expect(page.saveNotice()).toContain('La semana se ha guardado');
    expect(page.saveNotice()).toContain('no vuelvas a guardar');
  });
});
