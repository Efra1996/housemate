import type { Chore } from './chore.interface';
import type { Mate } from './mate.interface';
import type { Task } from './task.interface';

export interface WeeklyScheduleInput {
  weekStart: string;
  mates: readonly Mate[];
  availableMateIds: readonly string[];
  chores: readonly Chore[];
  history: readonly Task[];
}

export interface WeeklyAssignment extends Task {
  choreId: string;
  mateId: string;
  weekStart: string;
}

export interface SkippedChore {
  choreId: string;
  reason: 'inactive' | 'no-eligible-mate' | 'availability-policy' | 'no-valid-assignment';
}

export interface WeeklySchedule {
  weekStart: string;
  status: 'ready' | 'skipped' | 'blocked';
  assignments: WeeklyAssignment[];
  skippedChores: SkippedChore[];
}

export interface SavedWeeklySchedule {
  weekStart: string;
  firstDeadline: string;
}
