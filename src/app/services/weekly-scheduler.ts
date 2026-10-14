import type { Chore } from '../interfaces/chore.interface';
import type { Task } from '../interfaces/task.interface';
import type { WeeklyAssignment, WeeklySchedule, WeeklyScheduleInput } from '../interfaces/weekly-schedule.interface';

export const CHORE_ORDER: readonly string[] = ['bathroom-a', 'bathroom-b', 'kitchen', 'hallway'];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface Choice {
  chore: Chore;
  mateId: string;
}

interface HistoryEntry {
  choreId: string;
  mateId: string;
  recency: number;
}

/** Pure scheduling function: no Firebase calls, mutations of input, or random choices. */
export function generateWeeklySchedule(input: WeeklyScheduleInput): WeeklySchedule {
  const weekTime = validateInput(input);
  const available = [...input.availableMateIds].sort();
  const eligible = input.chores
    .filter((chore) => chore.active && eligibleMates(chore, available).length > 0)
    .sort((first, second) => CHORE_ORDER.indexOf(first.id) - CHORE_ORDER.indexOf(second.id));
  const history = readHistory(input.history, weekTime);
  const candidates = choreSets(eligible, available.length)
    .flatMap((chores) => assignChores(chores, available))
    .filter((candidate) => respectsWorkload(candidate, available.length));
  const ranked = candidates.sort((first, second) => compareCandidates(first, second, available, history));
  const selected = ranked[0];
  const status = available.length === 0 ? 'skipped' : selected?.length ? 'ready' : 'blocked';

  return {
    weekStart: input.weekStart,
    status,
    assignments: (selected ?? []).map((choice) => toAssignment(choice, input, weekTime)),
    skippedChores: [...input.chores].sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0)
      .flatMap((chore) => {
        const reason = skipReason(chore, selected ?? [], available, status);
        return reason ? [{ choreId: chore.id, reason }] : [];
      }),
  };
}

function validateInput(input: WeeklyScheduleInput): number {
  const weekTime = parseMonday(input.weekStart);
  if (weekTime === null) throw new Error('weekStart must be a valid Monday in YYYY-MM-DD format.');
  assertUnique(input.mates.map((mate) => mate.id), 'mate IDs');
  assertUnique(input.chores.map((chore) => chore.id), 'chore IDs');
  assertUnique(input.availableMateIds, 'available mate IDs');
  if (input.mates.length > 5) throw new Error('This scheduler supports up to five housemates.');
  const mateIds = new Set(input.mates.map((mate) => mate.id));
  if (input.availableMateIds.some((id) => !mateIds.has(id))) throw new Error('An available mate does not exist.');
  for (const chore of input.chores) {
    if (!CHORE_ORDER.some((id) => id === chore.id)) throw new Error(`Unsupported chore: ${chore.id}.`);
    if (chore.eligibleMateIds.some((id) => !mateIds.has(id))) throw new Error(`Unknown eligible mate for ${chore.id}.`);
  }
  return weekTime;
}

/** Validate edited proposals using the same eligibility and workload rules as generation. */
export function validateWeeklySchedule(schedule: WeeklySchedule, input: WeeklyScheduleInput): string {
  try {
    validateInput(input);
  } catch {
    return 'La semana, los compañeros o las tareas configuradas no son válidos.';
  }
  if (schedule.status !== 'ready' || !schedule.assignments.length || schedule.weekStart !== input.weekStart) {
    return 'Solo se puede guardar una propuesta válida con tareas.';
  }
  const ids = schedule.assignments.map((assignment) => assignment.choreId);
  if (new Set(ids).size !== ids.length) return 'La propuesta contiene tareas duplicadas.';
  const choices: Choice[] = [];
  for (const assignment of schedule.assignments) {
    const chore = input.chores.find((entry) => entry.id === assignment.choreId && entry.active);
    if (!chore || !input.availableMateIds.includes(assignment.mateId) || !chore.eligibleMateIds.includes(assignment.mateId)) {
      return 'Cada responsable debe estar disponible y poder realizar su tarea.';
    }
    if (!validAssignmentDetails(assignment, schedule.weekStart)) {
      return 'Revisa las referencias, los nombres y las fechas límite de las tareas.';
    }
    choices.push({ chore, mateId: assignment.mateId });
  }
  const eligible = input.chores.filter((chore) => chore.active && eligibleMates(chore, input.availableMateIds).length > 0);
  const validSet = choreSets(eligible, input.availableMateIds.length)
    .some((set) => set.length === ids.length && set.every((chore) => ids.includes(chore.id)));
  if (!validSet) return 'Las tareas de la propuesta no corresponden a la disponibilidad seleccionada.';
  return respectsWorkload(choices, input.availableMateIds.length)
    ? '' : 'Revisa el reparto: solo se permite combinar un baño y el pasillo cuando hay dos o tres compañeros.';
}

function validAssignmentDetails(assignment: WeeklyAssignment, weekStart: string): boolean {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const date = assignment.date;
  return assignment.id === `${weekStart}_${assignment.choreId}` && assignment.weekStart === weekStart
    && !!assignment.task.trim() && !!assignment.mate.trim() && assignment.todo === true
    && date instanceof Date && Number.isFinite(date.getTime()) && date >= start && date < end
    && date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
}

function assertUnique(ids: readonly string[], label: string): void {
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error(`Expected non-empty, unique ${label}.`);
  }
}

function parseMonday(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1
    ? date.getTime() : null;
}

function readHistory(tasks: readonly Task[], weekTime: number): HistoryEntry[] {
  const seen = new Set<string>();
  const entries: HistoryEntry[] = [];
  for (const task of tasks) {
    const time = task.weekStart ? parseMonday(task.weekStart) : null;
    if (seen.has(task.id) || !task.choreId || !task.mateId || time === null
      || time < weekTime - 4 * WEEK_MS || time >= weekTime) continue;
    seen.add(task.id);
    entries.push({ choreId: task.choreId, mateId: task.mateId, recency: (time - (weekTime - 4 * WEEK_MS)) / WEEK_MS + 1 });
  }
  return entries;
}

function isBathroom(chore: Chore): boolean {
  return chore.id === 'bathroom-a' || chore.id === 'bathroom-b';
}

function eligibleMates(chore: Chore, available: readonly string[]): string[] {
  return available.filter((id) => chore.eligibleMateIds.includes(id));
}

function choreSets(chores: Chore[], availableCount: number): Chore[][] {
  if (availableCount === 0) return [];
  if (availableCount === 1) return chores.map((chore) => [chore]);
  if (availableCount !== 2) return [chores];
  const bathrooms = chores.filter(isBathroom);
  const shared = chores.filter((chore) => !isBathroom(chore));
  return bathrooms.length ? bathrooms.map((bathroom) => [bathroom, ...shared]) : [shared];
}

function assignChores(chores: readonly Chore[], available: readonly string[]): Choice[][] {
  let candidates: Choice[][] = [[]];
  for (const chore of chores) {
    candidates = candidates.flatMap((candidate) => eligibleMates(chore, available)
      .map((mateId) => [...candidate, { chore, mateId }]));
  }
  return candidates;
}

function respectsWorkload(candidate: readonly Choice[], availableCount: number): boolean {
  const ids = new Set(candidate.map((choice) => choice.mateId));
  for (const id of ids) {
    const duties = candidate.filter((choice) => choice.mateId === id);
    if (duties.length <= 1) continue;
    const canDouble = availableCount === 2 || (availableCount === 3 && candidate.length === 4);
    if (!canDouble || duties.length !== 2 || !duties.some((choice) => isBathroom(choice.chore))
      || !duties.some((choice) => choice.chore.id === 'hallway')) return false;
  }
  // With two people, the selected bathroom cleaner must also take the hallway.
  const bathroom = candidate.find((choice) => isBathroom(choice.chore));
  const hallway = candidate.find((choice) => choice.chore.id === 'hallway');
  return availableCount !== 2 || !bathroom || !hallway || bathroom.mateId === hallway.mateId;
}

function compareCandidates(first: Choice[], second: Choice[], available: string[], history: HistoryEntry[]): number {
  const firstScore = scoreCandidate(first, available, history);
  const secondScore = scoreCandidate(second, available, history);
  for (let index = 0; index < firstScore.length; index += 1) {
    const difference = firstScore[index] - secondScore[index];
    if (difference !== 0) return difference;
  }
  const firstKey = first.map((choice) => `${choice.chore.id}:${choice.mateId}`).join('|');
  const secondKey = second.map((choice) => `${choice.chore.id}:${choice.mateId}`).join('|');
  return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
}

function scoreCandidate(candidate: Choice[], available: string[], history: HistoryEntry[]): number[] {
  // Squared projected loads balance all duties equally, including the extra hallway.
  const workload = available.reduce((sum, id) => {
    const previous = history.filter((entry) => entry.mateId === id).length;
    const added = candidate.filter((choice) => choice.mateId === id).length;
    return sum + (previous + added) ** 2;
  }, 0);
  const personalRecency = candidate.reduce((sum, choice) => sum + lastAssigned(history, choice.chore.id, choice.mateId), 0);
  const priorityChore = available.length === 1 ? candidate[0]?.chore : candidate.find((choice) => isBathroom(choice.chore))?.chore;
  const choreRecency = priorityChore ? lastAssigned(history, priorityChore.id) : 0;
  return available.length <= 2 ? [choreRecency, workload, personalRecency] : [workload, personalRecency];
}

function lastAssigned(history: HistoryEntry[], choreId: string, mateId?: string): number {
  return history.filter((entry) => entry.choreId === choreId && (mateId === undefined || entry.mateId === mateId))
    .reduce((latest, entry) => Math.max(latest, entry.recency), 0);
}

function toAssignment(choice: Choice, input: WeeklyScheduleInput, weekTime: number): WeeklyAssignment {
  const mate = input.mates.find((entry) => entry.id === choice.mateId);
  if (!mate) throw new Error(`Unknown assigned mate: ${choice.mateId}.`);
  const sunday = new Date(weekTime + 6 * 24 * 60 * 60 * 1000);
  // Match the app's calendar-date convention: midnight in the browser's local zone.
  const date = new Date(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate());
  return {
    id: `${input.weekStart}_${choice.chore.id}`, choreId: choice.chore.id, mateId: mate.id,
    weekStart: input.weekStart, task: choice.chore.title, mate: mate.nombre, date, todo: true,
  };
}

function skipReason(chore: Chore, selected: Choice[], available: string[], status: WeeklySchedule['status']): WeeklySchedule['skippedChores'][number]['reason'] | undefined {
  if (selected.some((choice) => choice.chore.id === chore.id)) return undefined;
  if (!chore.active) return 'inactive';
  if (!eligibleMates(chore, available).length) return 'no-eligible-mate';
  return status === 'blocked' ? 'no-valid-assignment' : 'availability-policy';
}
