import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { OnChanges, SimpleChanges } from '@angular/core';
import {
  IonAvatar, IonButton, IonButtons, IonContent, IonFooter, IonHeader,
  IonIcon, IonModal, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import type { Chore } from '../../interfaces/chore.interface';
import type { Mate } from '../../interfaces/mate.interface';
import type { Task } from '../../interfaces/task.interface';
import { ChoresService } from '../../services/chores.service';
import { TasksService } from '../../services/tasks.service';

const COLUMNS = [
  { id: 'bathroom-a', label: 'Baño A', title: 'Limpiar el baño A' },
  { id: 'bathroom-b', label: 'Baño B', title: 'Limpiar el baño B' },
  { id: 'kitchen', label: 'Cocina', title: 'Limpiar la cocina' },
  { id: 'hallway', label: 'Pasillo', title: 'Limpiar el pasillo' },
];

@Component({
  selector: 'app-task-counter',
  templateUrl: './task-counter.component.html',
  styleUrls: ['./task-counter.component.scss'],
  imports: [IonAvatar, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonModal, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar],
})
export class TaskCounterComponent implements OnChanges {
  readonly isOpen = input(false);
  readonly mates = input<readonly Mate[]>([]);
  readonly initialMonth = input('');
  readonly dismissed = output<void>();
  readonly columns = COLUMNS;
  readonly mode = signal<'assigned' | 'completed'>('assigned');
  readonly period = signal('all');
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal('');
  private readonly tasks = signal<Task[]>([]);
  private readonly chores = signal<Chore[]>([]);
  private readonly historyMonths = signal<string[]>([]);
  private readonly undatedTasks = signal(0);
  private readonly tasksService = inject(TasksService);
  private readonly choresService = inject(ChoresService);
  private readonly avatarColors = ['peach', 'sage', 'lavender', 'blue', 'sand'];
  private requestId = 0;

  readonly periodLabel = computed(() => this.period() === 'all' ? 'Todo el historial' : this.monthLabel(this.period()));
  readonly months = computed(() => this.monthOptions(this.historyMonths(), this.initialMonth()));
  readonly counts = computed(() => this.countTasks(this.tasks()));
  readonly rows = computed(() => this.mates().map((mate, index) => {
    const values = COLUMNS.map((column) => this.counts().values.get(`${mate.id}:${column.id}`) ?? 0);
    return { mate, values, total: values.reduce((sum, count) => sum + count, 0), color: this.avatarColors[index % this.avatarColors.length] };
  }));
  readonly totals = computed(() => COLUMNS.map((_, index) => this.rows().reduce((sum, row) => sum + row.values[index], 0)));
  readonly total = computed(() => this.totals().reduce((sum, count) => sum + count, 0));
  readonly missingWeekDates = computed(() => this.period() !== 'all' ? this.undatedTasks() : 0);

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue === true) {
      this.mode.set('assigned');
      this.period.set('all');
      this.historyMonths.set([]);
      this.undatedTasks.set(0);
      void this.reload(true);
    } else if (changes['isOpen']?.currentValue === false) {
      this.requestId += 1;
      this.loading.set(false);
    }
  }

  changePeriod(value: unknown): void {
    if (typeof value !== 'string' || (value !== 'all' && !this.months().includes(value))) return;
    if (value === this.period()) return;
    this.period.set(value);
    void this.reload();
  }

  changeMode(mode: 'assigned' | 'completed'): void {
    this.mode.set(mode);
    void this.reload();
  }

  async reload(refreshChores = false): Promise<void> {
    const request = ++this.requestId;
    const period = this.period();
    const completedOnly = this.mode() === 'completed';
    this.loading.set(true);
    this.loaded.set(false);
    this.error.set('');
    this.tasks.set([]);
    try {
      const [tasks, chores] = await Promise.all([
        this.tasksService.getTasksForCounter(period === 'all' ? null : period, completedOnly),
        refreshChores ? this.choresService.getActiveChores() : Promise.resolve(this.chores()),
      ]);
      if (request !== this.requestId) return;
      this.tasks.set(tasks);
      this.chores.set(chores);
      if (period === 'all' && !completedOnly) {
        this.historyMonths.set([...new Set(tasks.flatMap((task) => task.weekStart ? [task.weekStart.slice(0, 7)] : []))].sort());
        this.undatedTasks.set(tasks.filter((task) => !task.weekStart).length);
      }
      this.loaded.set(true);
    } catch {
      if (request === this.requestId) this.error.set('No se pudo cargar el contador. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      if (request === this.requestId) this.loading.set(false);
    }
  }

  monthLabel(month: string): string {
    const [year, number] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${String(year).padStart(4, '0')}-${String(number).padStart(2, '0')}-01T00:00:00Z`));
  }

  isEligible(mateId: string, choreId: string): boolean {
    const chore = this.chores().find((entry) => entry.id === choreId);
    return !chore || chore.eligibleMateIds.includes(mateId);
  }

  private countTasks(tasks: readonly Task[]): { values: Map<string, number>; unmatched: number } {
    const values = new Map<string, number>();
    let unmatched = 0;
    for (const task of tasks) {
      const mateId = this.resolveMateId(task);
      const choreId = this.resolveChoreId(task);
      if (!mateId || !choreId) { unmatched += 1; continue; }
      const key = `${mateId}:${choreId}`;
      values.set(key, (values.get(key) ?? 0) + 1);
    }
    return { values, unmatched };
  }

  private resolveMateId(task: Task): string | undefined {
    if (task.mateId) return this.mates().find((mate) => mate.id === task.mateId)?.id;
    const matches = this.mates().filter((mate) => this.normalize(mate.nombre) === this.normalize(task.mate));
    return matches.length === 1 ? matches[0].id : undefined;
  }

  private resolveChoreId(task: Task): string | undefined {
    if (task.choreId) return COLUMNS.find((column) => column.id === task.choreId)?.id;
    const matches = COLUMNS.filter((column) => this.normalize(column.title) === this.normalize(task.task)
      || this.chores().some((chore) => chore.id === column.id && this.normalize(chore.title) === this.normalize(task.task)));
    return matches.length === 1 ? matches[0].id : undefined;
  }

  private normalize(value: string): string {
    return value.trim().toLocaleLowerCase('es');
  }

  private monthOptions(history: readonly string[], initialMonth: string): string[] {
    const current = new Date();
    const currentMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
    const keys = [...history, currentMonth];
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth)) keys.push(initialMonth);
    keys.sort();
    const [firstYear, firstMonth] = keys[0].split('-').map(Number);
    const [lastYear, lastMonth] = keys[keys.length - 1].split('-').map(Number);
    const first = firstYear * 12 + firstMonth - 1;
    const last = lastYear * 12 + lastMonth - 1;
    return Array.from({ length: last - first + 1 }, (_, index) => {
      const value = last - index;
      return `${String(Math.floor(value / 12)).padStart(4, '0')}-${String(value % 12 + 1).padStart(2, '0')}`;
    });
  }
}
