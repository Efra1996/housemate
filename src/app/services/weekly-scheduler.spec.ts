import { describe, expect, it } from 'vitest';
import type { Chore } from '../interfaces/chore.interface';
import type { Mate } from '../interfaces/mate.interface';
import type { Task } from '../interfaces/task.interface';
import type { WeeklyScheduleInput } from '../interfaces/weekly-schedule.interface';
import { generateWeeklySchedule, validateWeeklySchedule } from './weekly-scheduler';

const mates: Mate[] = ['Efra', 'David', 'Ainara', 'Izaro', 'Marcela']
  .map((nombre, index) => ({ id: `mate-${index + 1}`, nombre, avatar: nombre[0] }));
const allIds = mates.map((mate) => mate.id);
const chores: Chore[] = [
  { id: 'bathroom-a', title: 'Limpiar el baño A', eligibleMateIds: allIds.slice(0, 3), active: true },
  { id: 'bathroom-b', title: 'Limpiar el baño B', eligibleMateIds: allIds.slice(3), active: true },
  { id: 'kitchen', title: 'Limpiar la cocina', eligibleMateIds: allIds, active: true },
  { id: 'hallway', title: 'Limpiar el pasillo', eligibleMateIds: allIds, active: true },
];

function input(available = allIds, history: Task[] = []): WeeklyScheduleInput {
  return { weekStart: '2026-10-12', mates, chores, availableMateIds: available, history };
}

function past(choreId: string, mateId: string, weekStart = '2026-10-05', todo = true): Task {
  return { id: `${weekStart}_${choreId}_${mateId}`, choreId, mateId, weekStart, task: choreId, mate: mateId, date: new Date('2030-01-01'), todo };
}

function dutyCounts(assignments: { mateId: string }[]): number[] {
  return allIds.map((id) => assignments.filter((task) => task.mateId === id).length);
}

describe('validateWeeklySchedule', () => {
  it('accepts every generated ready proposal across all availability combinations', () => {
    for (let mask = 1; mask < 32; mask += 1) {
      const selected = allIds.filter((_, index) => (mask & (1 << index)) !== 0);
      const context = input(selected);
      expect(validateWeeklySchedule(generateWeeklySchedule(context), context)).toBe('');
    }
  });

  it('rejects duplicate or missing chores', () => {
    const schedule = generateWeeklySchedule(input());
    expect(validateWeeklySchedule({ ...schedule, assignments: [...schedule.assignments, schedule.assignments[0]] }, input())).not.toBe('');
    expect(validateWeeklySchedule({ ...schedule, assignments: schedule.assignments.slice(1) }, input())).not.toBe('');
  });

  it('rejects unavailable or ineligible replacements', () => {
    const context = input(['mate-1', 'mate-2', 'mate-4', 'mate-5']);
    const schedule = generateWeeklySchedule(context);
    for (const mateId of ['mate-3', 'mate-4', 'missing']) {
      const assignments = schedule.assignments.map((task) => task.choreId === 'bathroom-a' ? { ...task, mateId } : task);
      expect(validateWeeklySchedule({ ...schedule, assignments }, context)).not.toBe('');
    }
  });

  it('rejects invalid task references, deadlines, names, and completion status', () => {
    const schedule = generateWeeklySchedule(input());
    const invalidDetails = [
      { id: 'wrong-id' }, { weekStart: '2026-10-05' }, { date: new Date(NaN) },
      { date: new Date(2026, 9, 11) }, { date: new Date(2026, 9, 19) },
      { date: new Date(2026, 9, 14, 12) }, { task: ' ' }, { mate: '' }, { todo: false },
    ];
    for (const changes of invalidDetails) {
      const assignments = schedule.assignments.map((task, index) => index === 0 ? { ...task, ...changes } : task);
      expect(validateWeeklySchedule({ ...schedule, assignments }, input())).not.toBe('');
    }
  });

  it('rejects invalid edited workload and two-person bathroom/hallway splits', () => {
    const context = input(['mate-1', 'mate-2']);
    const schedule = generateWeeklySchedule(context);
    const hallway = schedule.assignments.find((task) => task.choreId === 'hallway');
    const assignments = schedule.assignments.map((task) => task.choreId === 'hallway'
      ? { ...task, mateId: hallway?.mateId === 'mate-1' ? 'mate-2' : 'mate-1' } : task);
    expect(validateWeeklySchedule({ ...schedule, assignments }, context)).not.toBe('');
  });

  it('rejects skipped, blocked, or mismatched-week proposals', () => {
    const schedule = generateWeeklySchedule(input());
    expect(validateWeeklySchedule({ ...schedule, status: 'blocked' }, input())).not.toBe('');
    expect(validateWeeklySchedule(generateWeeklySchedule(input([])), input([]))).not.toBe('');
    expect(validateWeeklySchedule(schedule, { ...input(), weekStart: '2026-10-19' })).not.toBe('');
  });
});

describe('generateWeeklySchedule', () => {
  it('skips a week when everyone is away', () => {
    const result = generateWeeklySchedule(input([]));
    expect(result.status).toBe('skipped');
    expect(result.assignments).toEqual([]);
    expect(result.skippedChores).toHaveLength(4);
  });

  it('gives one person just their least-recent eligible chore', () => {
    const history = [past('bathroom-b', 'mate-5'), past('kitchen', 'mate-1'), past('hallway', 'mate-2', '2026-09-28')];
    const result = generateWeeklySchedule(input(['mate-5'], history));
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].choreId).toBe('hallway');
    expect(result.assignments[0].mateId).toBe('mate-5');
  });

  it('chooses one bathroom for two people in different groups', () => {
    const result = generateWeeklySchedule(input(['mate-1', 'mate-4'], [past('bathroom-a', 'mate-2')]));
    expect(result.assignments.map((task) => task.choreId)).toEqual(['bathroom-b', 'kitchen', 'hallway']);
    expect(result.assignments.find((task) => task.choreId === 'hallway')?.mateId).toBe('mate-4');
    expect(result.assignments.find((task) => task.choreId === 'kitchen')?.mateId).toBe('mate-1');
    expect(result.skippedChores).toContainEqual({ choreId: 'bathroom-a', reason: 'availability-policy' });
  });

  it('balances the double duty when two people share a bathroom', () => {
    const history = [past('kitchen', 'mate-1'), past('hallway', 'mate-1')];
    const result = generateWeeklySchedule(input(['mate-1', 'mate-2'], history));
    expect(result.assignments.find((task) => task.choreId === 'bathroom-a')?.mateId).toBe('mate-2');
    expect(result.assignments.find((task) => task.choreId === 'hallway')?.mateId).toBe('mate-2');
    expect(result.assignments.find((task) => task.choreId === 'kitchen')?.mateId).toBe('mate-1');
    expect(result.skippedChores).toContainEqual({ choreId: 'bathroom-b', reason: 'no-eligible-mate' });
  });

  it('assigns three separate duties when three people share one bathroom', () => {
    const result = generateWeeklySchedule(input(allIds.slice(0, 3)));
    expect(result.assignments).toHaveLength(3);
    expect(dutyCounts(result.assignments)).toEqual([1, 1, 1, 0, 0]);
    expect(result.skippedChores).toContainEqual({ choreId: 'bathroom-b', reason: 'no-eligible-mate' });
  });

  it('only pairs hallway with a bathroom for three people in both groups', () => {
    const result = generateWeeklySchedule(input(['mate-1', 'mate-2', 'mate-4']));
    expect(result.assignments).toHaveLength(4);
    const hallway = result.assignments.find((task) => task.choreId === 'hallway');
    const doubled = result.assignments.filter((task) => task.mateId === hallway?.mateId);
    expect(doubled).toHaveLength(2);
    expect(doubled.some((task) => task.choreId.startsWith('bathroom-'))).toBe(true);
    expect(new Set(result.assignments.map((task) => task.mateId)).size).toBe(3);
  });

  it('gives four available people one duty each', () => {
    const result = generateWeeklySchedule(input(['mate-1', 'mate-2', 'mate-4', 'mate-5']));
    expect(result.assignments).toHaveLength(4);
    expect(new Set(result.assignments.map((task) => task.mateId)).size).toBe(4);
  });

  it('gives five people four distinct assignments and a week off', () => {
    const result = generateWeeklySchedule(input());
    expect(result.status).toBe('ready');
    expect(result.assignments).toHaveLength(4);
    expect(new Set(result.assignments.map((task) => task.mateId)).size).toBe(4);
    expect(result.skippedChores).toEqual([]);
  });

  it('respects every eligible-mate restriction', () => {
    const result = generateWeeklySchedule(input());
    for (const assignment of result.assignments) {
      expect(chores.find((chore) => chore.id === assignment.choreId)?.eligibleMateIds).toContain(assignment.mateId);
    }
  });

  it('prioritizes lower workload, including unfinished assignments', () => {
    const history = [past('bathroom-a', 'mate-1'), past('kitchen', 'mate-1'), past('hallway', 'mate-1')];
    const result = generateWeeklySchedule(input(allIds, history));
    expect(result.assignments.some((task) => task.mateId === 'mate-1')).toBe(false);
  });

  it('counts completed and pending history equally', () => {
    const pending = [past('bathroom-a', 'mate-1'), past('hallway', 'mate-1')];
    const completed = pending.map((task) => ({ ...task, todo: false }));
    expect(generateWeeklySchedule(input(allIds, completed))).toEqual(generateWeeklySchedule(input(allIds, pending)));
  });

  it('uses personal chore recency when workloads tie', () => {
    const history = allIds.map((id) => past(id === 'mate-1' ? 'bathroom-a' : 'kitchen', id));
    const result = generateWeeklySchedule(input(allIds, history));
    expect(result.assignments.find((task) => task.choreId === 'bathroom-a')?.mateId).not.toBe('mate-1');
  });

  it('uses exactly the preceding four weeks and ignores editable deadlines', () => {
    const inside = [past('bathroom-a', 'mate-1', '2026-09-14')];
    const outside = [past('kitchen', 'mate-1', '2026-09-07'), past('hallway', 'mate-2', '2026-10-12'), past('bathroom-b', 'mate-4', '2026-10-19')];
    expect(generateWeeklySchedule(input(allIds, [...inside, ...outside]))).toEqual(generateWeeklySchedule(input(allIds, inside)));
  });

  it('does not double-count duplicate history documents', () => {
    const history = [past('kitchen', 'mate-1')];
    expect(generateWeeklySchedule(input(allIds, [...history, ...history]))).toEqual(generateWeeklySchedule(input(allIds, history)));
  });

  it('ignores legacy history without scheduling references', () => {
    const legacy: Task = { id: 'task-1', task: 'baño', mate: 'Efra', date: new Date(), todo: true };
    expect(generateWeeklySchedule(input(allIds, [legacy]))).toEqual(generateWeeklySchedule(input()));
  });

  it('skips inactive chores and preserves the other duties', () => {
    const result = generateWeeklySchedule({ ...input(), chores: chores.map((chore) => ({ ...chore, active: chore.id !== 'hallway' })) });
    expect(result.assignments).toHaveLength(3);
    expect(result.skippedChores).toContainEqual({ choreId: 'hallway', reason: 'inactive' });
  });

  it('returns a blocked result rather than assigning an invalid workload', () => {
    const restricted = chores.map((chore) => ({ ...chore, eligibleMateIds: ['mate-1'] }));
    const result = generateWeeklySchedule({ ...input(allIds.slice(0, 4)), chores: restricted });
    expect(result.status).toBe('blocked');
    expect(result.assignments).toEqual([]);
    expect(result.skippedChores.every((chore) => chore.reason === 'no-valid-assignment')).toBe(true);
  });

  it('makes deterministic choices regardless of input order', () => {
    const original = input();
    const reversed = { ...original, mates: [...mates].reverse(), chores: [...chores].reverse(), availableMateIds: [...allIds].reverse() };
    expect(generateWeeklySchedule(reversed).assignments).toEqual(generateWeeklySchedule(original).assignments);
  });

  it('creates deterministic IDs, Sunday dates, and name snapshots', () => {
    const result = generateWeeklySchedule(input());
    for (const assignment of result.assignments) {
      expect(assignment.id).toBe(`2026-10-12_${assignment.choreId}`);
      expect(assignment.weekStart).toBe('2026-10-12');
      expect(assignment.date.getDay()).toBe(0);
      expect(assignment.date.getDate()).toBe(18);
      expect(assignment.date.getHours()).toBe(0);
      expect(assignment.todo).toBe(true);
      expect(assignment.mate).toBe(mates.find((mate) => mate.id === assignment.mateId)?.nombre);
    }
  });

  it('does not mutate any input data', () => {
    const original = input(allIds, [past('kitchen', 'mate-1')]);
    const before = structuredClone(original);
    generateWeeklySchedule(original);
    expect(original).toEqual(before);
  });

  it.each(['2026-10-13', '2026-02-30', 'not-a-date'])('rejects invalid Monday dates: %s', (weekStart) => {
    expect(() => generateWeeklySchedule({ ...input(), weekStart })).toThrow('valid Monday');
  });

  it('rejects unknown or duplicate available housemates', () => {
    expect(() => generateWeeklySchedule(input(['missing']))).toThrow('does not exist');
    expect(() => generateWeeklySchedule(input(['mate-1', 'mate-1']))).toThrow('unique');
  });

  it('rejects unsupported chore definitions rather than silently dropping them', () => {
    expect(() => generateWeeklySchedule({ ...input(), chores: [...chores, { id: 'living-room', title: 'Salón', active: true, eligibleMateIds: allIds }] })).toThrow('Unsupported chore');
  });
});
