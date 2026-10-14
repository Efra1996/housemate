import { TestBed } from '@angular/core/testing';
import type { DocumentReference, Transaction } from 'firebase/firestore';
import { Timestamp, doc, runTransaction } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chore } from '../interfaces/chore.interface';
import type { Mate } from '../interfaces/mate.interface';
import type { Task } from '../interfaces/task.interface';
import { ChoresService } from './chores.service';
import { FirebaseService } from './firebase.service';
import { MatesService } from './mates.service';
import { TasksService } from './tasks.service';
import { CHORE_ORDER, generateWeeklySchedule } from './weekly-scheduler';

vi.mock('firebase/firestore', { spy: true });

const firestoreMocks = { doc: vi.mocked(doc), runTransaction: vi.mocked(runTransaction) };

const mates: Mate[] = ['Efra', 'David', 'Ainara', 'Izaro', 'Marcela']
  .map((nombre, index) => ({ id: `mate-${index + 1}`, nombre, avatar: nombre[0] }));
const ids = mates.map((mate) => mate.id);
const chores: Chore[] = [
  { id: 'bathroom-a', title: 'Baño A', eligibleMateIds: ids.slice(0, 3), active: true },
  { id: 'bathroom-b', title: 'Baño B', eligibleMateIds: ids.slice(3), active: true },
  { id: 'kitchen', title: 'Cocina', eligibleMateIds: ids, active: true },
  { id: 'hallway', title: 'Pasillo', eligibleMateIds: ids, active: true },
];

function proposal(available = ids) {
  return generateWeeklySchedule({ weekStart: '2026-10-12', mates, chores, availableMateIds: available, history: [] });
}

function existing(weekStart?: string): Task {
  return { id: 'noncanonical-id', task: 'Cocina', mate: 'Efra', date: new Date(2026, 9, 18), todo: false, weekStart };
}

describe('TasksService weekly saving', () => {
  let service: TasksService;
  const choresService = { getActiveChores: vi.fn<() => Promise<Chore[]>>() };
  const matesService = { getMates: vi.fn<() => Promise<Mate[]>>() };
  const transaction = {
    get: vi.fn<(reference: DocumentReference) => Promise<{ exists: () => boolean }>>(),
    set: vi.fn<(reference: DocumentReference, data: Record<string, unknown>) => void>(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    choresService.getActiveChores.mockResolvedValue(chores);
    matesService.getMates.mockResolvedValue(mates);
    transaction.get.mockResolvedValue({ exists: () => false });
    firestoreMocks.doc.mockImplementation((_database, collection, ...segments) => ({ id: segments[0], path: `${collection}/${segments[0]}` }) as DocumentReference);
    firestoreMocks.runTransaction.mockImplementation((_database, update) => update(transaction as unknown as Transaction));
    TestBed.configureTestingModule({ providers: [
      { provide: FirebaseService, useValue: { firestore: {} } },
      { provide: ChoresService, useValue: choresService },
      { provide: MatesService, useValue: matesService },
    ] });
    service = TestBed.inject(TasksService);
    vi.spyOn(service, 'getTasksForWeekRange').mockResolvedValue([]);
    vi.spyOn(service, 'getTasksForDateRange').mockResolvedValue([]);
  });

  it('reads every deterministic ID before atomically writing all assignments', async () => {
    const schedule = proposal();
    await service.saveWeeklySchedule(schedule, ids);
    expect(firestoreMocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(transaction.get.mock.calls.map(([reference]) => reference.id)).toEqual(CHORE_ORDER.map((id) => `2026-10-12_${id}`));
    expect(transaction.get.mock.invocationCallOrder.every((order) => order < transaction.set.mock.invocationCallOrder[0])).toBe(true);
    expect(transaction.set).toHaveBeenCalledTimes(4);
    for (const assignment of schedule.assignments) {
      expect(transaction.set).toHaveBeenCalledWith(expect.objectContaining({ id: assignment.id }), {
        task: assignment.task, mate: assignment.mate, choreId: assignment.choreId,
        mateId: assignment.mateId, weekStart: '2026-10-12', date: Timestamp.fromDate(assignment.date), todo: true,
      });
    }
  });

  it('detects a conflict in a skipped chore and writes nothing', async () => {
    const schedule = proposal(['mate-1']);
    const skippedId = schedule.skippedChores[0].choreId;
    transaction.get.mockImplementation(async (reference) => ({ exists: () => reference.id === `2026-10-12_${skippedId}` }));
    await expect(service.saveWeeklySchedule(schedule, ['mate-1'])).rejects.toMatchObject({ code: 'week-already-organized' });
    expect(transaction.get).toHaveBeenCalledTimes(4);
    expect(transaction.set).not.toHaveBeenCalled();
  });

  it('rejects noncanonical and legacy tasks found in the preflight check', async () => {
    vi.mocked(service.getTasksForWeekRange).mockResolvedValueOnce([existing('2026-10-12')]);
    await expect(service.saveWeeklySchedule(proposal(), ids)).rejects.toMatchObject({ code: 'week-already-organized' });
    vi.mocked(service.getTasksForDateRange).mockResolvedValueOnce([existing()]);
    await expect(service.saveWeeklySchedule(proposal(), ids)).rejects.toMatchObject({ code: 'week-already-organized' });
    expect(firestoreMocks.runTransaction).not.toHaveBeenCalled();
  });

  it('ignores deadlines of tasks belonging to another week', async () => {
    vi.mocked(service.getTasksForDateRange).mockResolvedValue([existing('2026-10-05')]);
    await service.saveWeeklySchedule(proposal(), ids);
    expect(transaction.set).toHaveBeenCalledTimes(4);
  });

  it('checks current eligibility instead of trusting the preview', async () => {
    const schedule = proposal();
    const bathroom = schedule.assignments.find((task) => task.choreId === 'bathroom-a');
    choresService.getActiveChores.mockResolvedValue(chores.map((chore) => ({
      ...chore, eligibleMateIds: chore.id === 'bathroom-a'
        ? chore.eligibleMateIds.filter((id) => id !== bathroom?.mateId) : chore.eligibleMateIds,
    })));
    await expect(service.saveWeeklySchedule(schedule, ids)).rejects.toThrow();
    expect(firestoreMocks.runTransaction).not.toHaveBeenCalled();
  });

  it('writes current name snapshots and preserves an edited deadline', async () => {
    const schedule = proposal();
    schedule.assignments[0].date = new Date(2026, 9, 13);
    matesService.getMates.mockResolvedValue(mates.map((mate) => ({ ...mate, nombre: `${mate.nombre} actualizado` })));
    await service.saveWeeklySchedule(schedule, ids);
    expect(transaction.set.mock.calls[0][1]).toMatchObject({
      mate: `${schedule.assignments[0].mate} actualizado`, date: Timestamp.fromDate(new Date(2026, 9, 13)),
    });
  });

  it('rejects skipped, blocked, duplicated, and invalid edited proposals without writing', async () => {
    const valid = proposal();
    const invalid = [
      proposal([]), { ...valid, status: 'blocked' as const },
      { ...valid, assignments: [...valid.assignments, valid.assignments[0]] },
      { ...valid, assignments: valid.assignments.map((task) => ({ ...task, date: new Date(2026, 9, 19) })) },
    ];
    for (const schedule of invalid) await expect(service.saveWeeklySchedule(schedule, ids)).rejects.toThrow();
    expect(firestoreMocks.runTransaction).not.toHaveBeenCalled();
  });

  it('does not start a transaction if conflict checks fail', async () => {
    vi.mocked(service.getTasksForDateRange).mockRejectedValueOnce(new Error('Offline'));
    await expect(service.saveWeeklySchedule(proposal(), ids)).rejects.toThrow('Offline');
    expect(transaction.set).not.toHaveBeenCalled();
  });

  it('propagates failed commits without reporting success', async () => {
    firestoreMocks.runTransaction.mockRejectedValueOnce(new Error('Commit failed'));
    await expect(service.saveWeeklySchedule(proposal(), ids)).rejects.toThrow('Commit failed');
  });

  it('rejects a conflict found when Firestore retries a transaction', async () => {
    firestoreMocks.runTransaction.mockImplementationOnce(async (_database, update) => {
      await update(transaction as unknown as Transaction);
      // Simulate Firestore discarding the first attempt after a concurrent commit.
      transaction.set.mockClear();
      transaction.get.mockResolvedValue({ exists: () => true });
      await update(transaction as unknown as Transaction);
    });
    await expect(service.saveWeeklySchedule(proposal(), ids)).rejects.toMatchObject({ code: 'week-already-organized' });
    expect(transaction.set).not.toHaveBeenCalled();
  });
});
