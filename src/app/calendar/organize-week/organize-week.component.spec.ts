import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chore } from '../../interfaces/chore.interface';
import type { Mate } from '../../interfaces/mate.interface';
import type { Task } from '../../interfaces/task.interface';
import type { WeeklySchedule } from '../../interfaces/weekly-schedule.interface';
import { ChoresService } from '../../services/chores.service';
import { TasksService } from '../../services/tasks.service';
import { OrganizeWeekComponent } from './organize-week.component';

const mates: Mate[] = ['Efra', 'David', 'Ainara', 'Izaro', 'Marcela']
  .map((nombre, index) => ({ id: `mate-${index + 1}`, nombre, avatar: nombre[0] }));
const ids = mates.map((mate) => mate.id);
const chores: Chore[] = [
  { id: 'bathroom-a', title: 'Baño A', eligibleMateIds: ids.slice(0, 3), active: true },
  { id: 'bathroom-b', title: 'Baño B', eligibleMateIds: ids.slice(3), active: true },
  { id: 'kitchen', title: 'Cocina', eligibleMateIds: ids, active: true },
  { id: 'hallway', title: 'Pasillo', eligibleMateIds: ids, active: true },
];

function task(weekStart?: string): Task {
  return { id: 'existing', task: 'Cocina', mate: 'Efra', date: new Date(2026, 9, 18), todo: false, weekStart };
}

describe('OrganizeWeekComponent preview', () => {
  let component: OrganizeWeekComponent;
  const choresService = { getActiveChores: vi.fn<() => Promise<Chore[]>>() };
  const tasksService = {
    getTasksForWeekRange: vi.fn<(start: string, end: string) => Promise<Task[]>>(),
    getTasksForDateRange: vi.fn<(start: Date, end: Date) => Promise<Task[]>>(),
    saveWeeklySchedule: vi.fn<(proposal: WeeklySchedule, available: readonly string[]) => Promise<void>>(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    choresService.getActiveChores.mockResolvedValue(chores);
    tasksService.getTasksForWeekRange.mockResolvedValue([]);
    tasksService.getTasksForDateRange.mockResolvedValue([]);
    tasksService.saveWeeklySchedule.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [OrganizeWeekComponent],
      providers: [
        { provide: ChoresService, useValue: choresService },
        { provide: TasksService, useValue: tasksService },
      ],
    });
    const fixture = TestBed.createComponent(OrganizeWeekComponent);
    fixture.componentRef.setInput('mates', mates);
    fixture.detectChanges();
    component = fixture.componentInstance;
    component.changeWeek('2026-10-12');
    component.toggleAll(true);
  });

  it('loads four preceding weeks plus the chosen week using week keys', async () => {
    await component.loadInputs();
    expect(tasksService.getTasksForWeekRange).toHaveBeenCalledWith('2026-09-14', '2026-10-19');
    expect(tasksService.getTasksForDateRange).toHaveBeenCalledWith(new Date(2026, 9, 12), new Date(2026, 9, 19));
    component.generatePreview();
    expect(component.proposal()?.assignments).toHaveLength(4);
    expect(component.step()).toBe('review');
  });

  it('blocks generation when the week already has completed or pending tasks', async () => {
    tasksService.getTasksForWeekRange.mockResolvedValue([task('2026-10-12')]);
    await component.loadInputs();
    component.generatePreview();
    expect(component.existingWeek()).toBe(true);
    expect(component.canGenerate()).toBe(false);
    expect(component.proposal()).toBeNull();
  });

  it('also blocks generation for legacy tasks with no week key', async () => {
    tasksService.getTasksForDateRange.mockResolvedValue([task()]);
    await component.loadInputs();
    expect(component.existingWeek()).toBe(true);
  });

  it('does not treat edited deadlines from other weeks as conflicts', async () => {
    tasksService.getTasksForDateRange.mockResolvedValue([task('2026-10-05')]);
    await component.loadInputs();
    expect(component.existingWeek()).toBe(false);
    expect(component.canGenerate()).toBe(true);
  });

  it('allows retry after a failed read and never generates with missing data', async () => {
    choresService.getActiveChores.mockRejectedValueOnce(new Error('Network failure'));
    await component.loadInputs();
    component.generatePreview();
    expect(component.error()).not.toBe('');
    expect(component.proposal()).toBeNull();
    await component.loadInputs();
    expect(component.error()).toBe('');
    expect(component.canGenerate()).toBe(true);
  });

  it('ignores an older response after a newer load finishes', async () => {
    let resolveOld: (value: Task[]) => void = () => undefined;
    tasksService.getTasksForWeekRange.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const older = component.loadInputs();
    component.changeWeek('2026-10-19');
    await component.loadInputs();
    resolveOld([task('2026-10-12')]);
    await older;
    expect(component.existingWeek()).toBe(false);
    expect(component.loading()).toBe(false);
    component.generatePreview();
    expect(component.proposal()?.weekStart).toBe('2026-10-19');
  });

  it('clears manual edits when availability changes and regenerates without more reads', async () => {
    await component.loadInputs();
    component.generatePreview();
    component.toggleMate('mate-5', false);
    expect(component.proposal()).toBeNull();
    component.generatePreview();
    expect(component.proposal()?.assignments.some((entry) => entry.mateId === 'mate-5')).toBe(false);
    expect(tasksService.getTasksForWeekRange).toHaveBeenCalledTimes(1);
  });

  it('restricts replacements to eligible, available housemates', async () => {
    await component.loadInputs();
    component.generatePreview();
    expect(component.eligibleMates('bathroom-a').map((mate) => mate.id)).toEqual(ids.slice(0, 3));
    const before = component.proposal();
    component.changeAssignee('bathroom-a', 'mate-4');
    expect(component.proposal()).toEqual(before);
    expect(component.editError()).not.toBe('');
    component.changeAssignee('bathroom-a', 'mate-2');
    expect(component.proposal()?.assignments.find((entry) => entry.choreId === 'bathroom-a')?.mate).toBe('David');
  });

  it('validates calendar dates and week boundaries before updating deadlines', async () => {
    await component.loadInputs();
    component.generatePreview();
    component.changeDeadline('kitchen', '2026-10-14');
    const assignment = component.proposal()?.assignments.find((entry) => entry.choreId === 'kitchen');
    expect(assignment?.date).toEqual(new Date(2026, 9, 14));
    for (const invalid of ['2026-10-19', '2026-10-11', '2026-02-30', '']) {
      component.changeDeadline('kitchen', invalid);
      expect(component.editError()).not.toBe('');
      expect(component.proposal()?.assignments.find((entry) => entry.choreId === 'kitchen')?.date).toEqual(assignment?.date);
    }
  });

  it('reports invalid manual workloads while allowing sequential reassignment', async () => {
    await component.loadInputs();
    component.generatePreview();
    const bathroomMate = component.proposal()?.assignments.find((entry) => entry.choreId === 'bathroom-a')?.mateId;
    component.changeAssignee('kitchen', bathroomMate);
    expect(component.workloadError()).not.toBe('');
    component.generatePreview();
    expect(component.workloadError()).toBe('');
  });

  it('shows a skipped preview when no one is available', async () => {
    await component.loadInputs();
    component.toggleAll(false);
    component.generatePreview();
    expect(component.proposal()?.status).toBe('skipped');
    expect(component.proposal()?.assignments).toEqual([]);
    expect(component.proposal()?.skippedChores).toHaveLength(4);
  });

  it('saves edited deadlines and emits success only after confirmation', async () => {
    await component.loadInputs();
    component.generatePreview();
    component.changeDeadline('kitchen', '2026-10-14');
    const saved = vi.fn();
    const dismissed = vi.fn();
    component.saved.subscribe(saved);
    component.dismissed.subscribe(dismissed);
    await component.savePreview();
    expect(tasksService.saveWeeklySchedule).toHaveBeenCalledWith(component.proposal(), ids);
    expect(saved).toHaveBeenCalledWith({ weekStart: '2026-10-12', firstDeadline: '2026-10-14' });
    expect(dismissed).toHaveBeenCalledTimes(1);
    await component.savePreview();
    expect(tasksService.saveWeeklySchedule).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate saves, edits, regeneration, and reloads while saving', async () => {
    await component.loadInputs();
    component.generatePreview();
    const before = structuredClone(component.proposal());
    let confirm: () => void = () => undefined;
    tasksService.saveWeeklySchedule.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const pending = component.savePreview();
    expect(component.saving()).toBe(true);
    expect(component.canSave()).toBe(false);
    await component.savePreview();
    component.toggleAll(false);
    component.toggleMate('mate-1', false);
    component.changeWeek('2026-10-19');
    component.changeAssignee('kitchen', 'mate-1');
    component.changeDeadline('kitchen', '2026-10-14');
    component.changeAvailability();
    component.generatePreview();
    await component.loadInputs();
    expect(component.proposal()).toEqual(before);
    expect(component.step()).toBe('review');
    expect(component.week().start).toBe('2026-10-12');
    expect(tasksService.saveWeeklySchedule).toHaveBeenCalledTimes(1);
    expect(tasksService.getTasksForWeekRange).toHaveBeenCalledTimes(1);
    confirm();
    await pending;
    expect(component.saving()).toBe(false);
  });

  it('preserves the proposal after failure and allows a save retry', async () => {
    await component.loadInputs();
    component.generatePreview();
    const before = structuredClone(component.proposal());
    const saved = vi.fn();
    const dismissed = vi.fn();
    component.saved.subscribe(saved);
    component.dismissed.subscribe(dismissed);
    tasksService.saveWeeklySchedule.mockRejectedValueOnce(new Error('Offline'));
    await component.savePreview();
    expect(component.proposal()).toEqual(before);
    expect(component.saveError()).not.toBe('');
    expect(component.canSave()).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    expect(dismissed).not.toHaveBeenCalled();
    await component.savePreview();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('keeps a conflicting proposal visible but blocks another save', async () => {
    await component.loadInputs();
    component.generatePreview();
    tasksService.saveWeeklySchedule.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { code: 'week-already-organized' }));
    await component.savePreview();
    expect(component.existingWeek()).toBe(true);
    expect(component.proposal()).not.toBeNull();
    expect(component.canSave()).toBe(false);
    expect(component.saveError()).toContain('No se ha sustituido');
  });

  it('does not clear an invalid deadline when editing a different field', async () => {
    await component.loadInputs();
    component.generatePreview();
    component.changeDeadline('kitchen', '2026-10-19');
    const hallwayMate = component.proposal()?.assignments.find((task) => task.choreId === 'hallway')?.mateId;
    component.changeAssignee('hallway', hallwayMate);
    expect(component.editError()).not.toBe('');
    expect(component.canSave()).toBe(false);
    await component.savePreview();
    expect(tasksService.saveWeeklySchedule).not.toHaveBeenCalled();
    component.changeDeadline('kitchen', '2026-10-18');
    expect(component.canSave()).toBe(true);
  });

  it('never saves skipped or manually invalid proposals', async () => {
    await component.loadInputs();
    component.generatePreview();
    const bathroomMate = component.proposal()?.assignments.find((task) => task.choreId === 'bathroom-a')?.mateId;
    component.changeAssignee('kitchen', bathroomMate);
    await component.savePreview();
    component.toggleAll(false);
    component.generatePreview();
    await component.savePreview();
    expect(tasksService.saveWeeklySchedule).not.toHaveBeenCalled();
  });
});
