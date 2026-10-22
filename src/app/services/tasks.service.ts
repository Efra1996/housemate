import { Injectable, inject } from '@angular/core';
import { Timestamp, collection, doc, getDocsFromServer, orderBy, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import type { Task } from '../interfaces/task.interface';
import type { WeeklySchedule } from '../interfaces/weekly-schedule.interface';
import { FirebaseService } from './firebase.service';
import { ChoresService } from './chores.service';
import { MatesService } from './mates.service';
import { CHORE_ORDER, validateWeeklySchedule } from './weekly-scheduler';

@Injectable({ providedIn: 'root' })
export class TasksService {
  private readonly firebase = inject(FirebaseService);
  private readonly choresService = inject(ChoresService);
  private readonly matesService = inject(MatesService);

  async getTasksForCounter(month: string | null, completedOnly = false): Promise<Task[]> {
    const tasks = collection(this.firebase.firestore, 'tasks');
    let request = query(tasks);
    if (month !== null) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Expected a month in YYYY-MM format.');
      const [year, monthNumber] = month.split('-').map(Number);
      const nextMonth = monthNumber === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${String(year).padStart(4, '0')}-${String(monthNumber + 1).padStart(2, '0')}`;
      request = query(tasks, where('weekStart', '>=', `${month}-01`), where('weekStart', '<', `${nextMonth}-01`), orderBy('weekStart'));
    } else if (completedOnly) {
      request = query(tasks, where('todo', '==', false));
    }
    const snapshot = await getDocsFromServer(request);
    // Filter monthly completion locally to avoid requiring a new composite index.
    return snapshot.docs.map((document) => this.toTask(document.id, document.data()))
      .filter((task) => !completedOnly || !task.todo);
  }

  async getPreviousCompletedTasks(tasks: readonly Task[]): Promise<Map<string, Task>> {
    const previous = new Map<string, Task>();
    const identified = tasks.filter((task) => task.choreId && task.weekStart);
    if (!identified.length) return previous;
    // One completed-history read serves all visible tasks, including month boundaries.
    const history = (await this.getTasksForCounter(null, true))
      .filter((task) => task.choreId && task.weekStart)
      .sort((first, second) => (second.weekStart ?? '').localeCompare(first.weekStart ?? '')
        || first.id.localeCompare(second.id));
    for (const task of identified) {
      const latest = history.find((candidate) => candidate.choreId === task.choreId
        && candidate.weekStart !== undefined && task.weekStart !== undefined && candidate.weekStart < task.weekStart);
      // Select before checking notes: an empty latest note must stop older notes resurfacing.
      if (latest) previous.set(task.id, latest);
    }
    return previous;
  }

  async updateTaskStatus(id: string, todo: boolean, notes?: string): Promise<void> {
    if (!id.trim() || id !== id.trim() || id.includes('/') || typeof todo !== 'boolean') {
      throw new Error('Expected a valid task document ID and a boolean todo status.');
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.trim().length > 500)) {
      throw new Error('Expected plain-text notes of at most 500 characters.');
    }
    // Save status and optional notes together; never recreate a deleted task.
    await updateDoc(doc(this.firebase.firestore, 'tasks', id),
      notes === undefined ? { todo } : { todo, notes: notes.trim() });
  }

  async saveWeeklySchedule(proposal: WeeklySchedule, availableMateIds: readonly string[]): Promise<void> {
    // Capture the reviewed proposal before any asynchronous reads.
    const schedule = {
      ...proposal, assignments: proposal.assignments.map((task) => ({ ...task, date: new Date(task.date) })),
    };
    const available = [...availableMateIds];
    const [chores, mates] = await Promise.all([this.choresService.getActiveChores(), this.matesService.getMates()]);
    const message = validateWeeklySchedule(schedule, {
      weekStart: schedule.weekStart, availableMateIds: available, chores, mates, history: [],
    });
    if (message) throw new Error(message);
    await this.ensureWeekIsEmpty(schedule.weekStart);
    const firestore = this.firebase.firestore;
    const references = CHORE_ORDER.map((id) => doc(firestore, 'tasks', `${schedule.weekStart}_${id}`));
    const notification = doc(firestore, 'weeklyNotificationEvents', schedule.weekStart);
    await runTransaction(firestore, async (transaction) => {
      // Read every chore ID, including skipped ones, before writing any tasks.
      const [snapshots, existingNotification] = await Promise.all([
        Promise.all(references.map((reference) => transaction.get(reference))),
        transaction.get(notification),
      ]);
      if (snapshots.some((snapshot) => snapshot.exists())) throw this.weekConflict();
      for (const assignment of schedule.assignments) {
        const reference = references.find((entry) => entry.id === assignment.id);
        if (!reference) throw new Error('Unknown weekly task ID.');
        transaction.set(reference, {
          task: chores.find((chore) => chore.id === assignment.choreId)?.title,
          mate: mates.find((mate) => mate.id === assignment.mateId)?.nombre,
          choreId: assignment.choreId, mateId: assignment.mateId, weekStart: schedule.weekStart,
          date: Timestamp.fromDate(assignment.date), todo: true,
        });
      }
      // A single event shares the task commit; previews/status edits never notify.
      // Retain an existing event when deleted tasks are later recreated.
      if (!existingNotification.exists()) {
        transaction.set(notification, {
          weekStart: schedule.weekStart,
          choreIds: schedule.assignments.map((assignment) => assignment.choreId),
          createdAt: serverTimestamp(),
        });
      }
    });
  }

  private async ensureWeekIsEmpty(weekStart: string): Promise<void> {
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const [weekly, dated] = await Promise.all([
      this.getTasksForWeekRange(weekStart, endKey), this.getTasksForDateRange(start, end),
    ]);
    // Noncanonical and legacy IDs are checked here, outside the transaction.
    if (weekly.length || dated.some((task) => !task.weekStart)) throw this.weekConflict();
  }

  private weekConflict(): Error & { code: string } {
    return Object.assign(new Error('This week already contains assigned tasks.'), { code: 'week-already-organized' });
  }

  // Week keys are ISO Monday dates, so their string ordering is chronological.
  async getTasksForWeekRange(start: string, end: string): Promise<Task[]> {
    for (const value of [start, end]) {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
        || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
        throw new Error('Expected valid Monday week keys in YYYY-MM-DD format.');
      }
    }
    if (start >= end) throw new Error('Expected the start week before the exclusive end week.');
    const snapshot = await getDocsFromServer(query(
      collection(this.firebase.firestore, 'tasks'),
      where('weekStart', '>=', start),
      where('weekStart', '<', end),
      orderBy('weekStart', 'asc'),
    ));
    return snapshot.docs.map((document) => this.toTask(document.id, document.data()));
  }

  async getPendingTasksForCurrentWeek(): Promise<Task[]> {
    const tasks = await this.getTasksForCurrentWeek();
    return tasks.filter((task) => task.todo);
  }

  async getTasksForCurrentWeek(): Promise<Task[]> {
    // Calendar boundaries follow the visitor's local time zone, starting Monday.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    return this.getTasksForDateRange(start, end);
  }

  // Inclusive start and exclusive end; includes pending and completed tasks.
  async getTasksForDateRange(start: Date, end: Date): Promise<Task[]> {
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new Error('Invalid task date range. Expected valid dates with start before end.');
    }

    const snapshot = await getDocsFromServer(query(
      collection(this.firebase.firestore, 'tasks'),
      where('date', '>=', Timestamp.fromDate(start)),
      where('date', '<', Timestamp.fromDate(end)),
      orderBy('date', 'asc'),
    ));

    return snapshot.docs.map((document) => this.toTask(document.id, document.data()));
  }

  private toTask(id: string, data: Record<string, unknown>): Task {
    const { task, mate, date, todo, choreId, mateId, weekStart, notes } = data;
    if (typeof task !== 'string' || !task.trim()
      || typeof mate !== 'string' || !mate.trim()
      || !(date instanceof Timestamp) || typeof todo !== 'boolean') {
      throw new Error(`Invalid task document: tasks/${id}. Expected task and mate strings, a date timestamp, and a todo boolean.`);
    }

    const result: Task = { id, task: task.trim(), mate: mate.trim(), date: date.toDate(), todo };
    if (notes !== undefined) {
      if (typeof notes !== 'string') throw new Error(`Invalid task document: tasks/${id}. Expected notes to be a string.`);
      result.notes = notes.trim();
    }
    if (choreId !== undefined) {
      result.choreId = this.readReference(id, 'choreId', choreId);
    }
    if (mateId !== undefined) {
      result.mateId = this.readReference(id, 'mateId', mateId);
    }
    if (weekStart !== undefined) {
      const value = this.readReference(id, 'weekStart', weekStart);
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== value || parsed.getUTCDay() !== 1) {
        throw new Error(`Invalid task document: tasks/${id}. Expected weekStart to be a valid Monday in YYYY-MM-DD format.`);
      }
      result.weekStart = value;
    }

    return result;
  }

  private readReference(id: string, field: string, value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
      throw new Error(`Invalid task document: tasks/${id}. Expected ${field} to be a non-empty string without slashes.`);
    }
    return value.trim();
  }
}
