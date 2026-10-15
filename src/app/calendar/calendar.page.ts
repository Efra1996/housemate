import { Component, computed, inject, signal } from '@angular/core';
import {
  IonAvatar, IonBadge, IonButton, IonCard, IonContent,
  IonDatetime, IonIcon, IonItem, IonLabel, IonList, IonSkeletonText,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { calendarOutline } from 'ionicons/icons';
import type { Mate } from '../interfaces/mate.interface';
import type { Task } from '../interfaces/task.interface';
import type { SavedWeeklySchedule } from '../interfaces/weekly-schedule.interface';
import { MatesService } from '../services/mates.service';
import { TasksService } from '../services/tasks.service';
import { OrganizeWeekComponent } from './organize-week/organize-week.component';
import { TaskDetailComponent } from './task-detail/task-detail.component';
import { TaskCounterComponent } from './task-counter/task-counter.component';

@Component({
  selector: 'app-calendar',
  templateUrl: 'calendar.page.html',
  styleUrls: ['calendar.page.scss'],
  imports: [IonAvatar, IonBadge, IonButton, IonCard, IonContent, IonDatetime, IonIcon, IonItem, IonLabel, IonList, IonSkeletonText, OrganizeWeekComponent, TaskDetailComponent, TaskCounterComponent],
})
export class CalendarPage {
  private readonly tasksService = inject(TasksService);
  private readonly matesService = inject(MatesService);
  private readonly avatarColors = ['peach', 'sage', 'lavender', 'blue', 'sand'];
  private requestId = 0;
  private loadedMonth: string | null = null;

  readonly selectedDate = signal(this.dateKey(new Date()));
  readonly expanded = signal(false);
  readonly organizerOpen = signal(false);
  readonly counterOpen = signal(false);
  readonly detailTask = signal<Task | null>(null);
  readonly detailMate = computed(() => {
    const task = this.detailTask();
    return task ? this.taskMate(task) : undefined;
  });
  readonly detailAvatarColor = computed(() => {
    const mate = this.detailMate();
    return mate ? this.avatarColor(mate.id) : 'peach';
  });
  readonly saveNotice = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly tasks = signal<Task[]>([]);
  readonly mates = signal<Mate[]>([]);
  readonly skeletonRows = [0, 1, 2];
  readonly weekdayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  readonly agenda = computed(() => this.tasks().filter((task) => this.dateKey(task.date) === this.selectedDate()));
  readonly monthLabel = computed(() => this.formatDate(this.selectedDate(), { month: 'long', year: 'numeric' }));
  readonly selectedDateLabel = computed(() => this.formatDate(this.selectedDate(), { weekday: 'long', day: 'numeric', month: 'long' }));

  readonly weekDays = computed(() => {
    const start = this.parseDate(this.selectedDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return this.weekdayLabels.map((label, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = this.dateKey(date);
      return {
        date: key, number: date.getDate(), label,
        fullLabel: this.formatDate(key, { weekday: 'long', day: 'numeric', month: 'long' }),
        taskCount: this.tasks().filter((task) => this.dateKey(task.date) === key).length,
      };
    });
  });

  readonly weekHasTasks = computed(() => this.weekDays().some((day) => day.taskCount > 0));

  // A new callback reference makes Ionic refresh highlights after data arrives.
  readonly highlightedDates = computed(() => {
    const dates = new Set(this.tasks().map((task) => this.dateKey(task.date)));
    return (date: string) => dates.has(date)
      ? { textColor: 'var(--ion-color-primary)', backgroundColor: 'var(--housemate-sage)' }
      : undefined;
  });

  constructor() {
    addIcons({ calendarOutline });
  }

  ionViewWillEnter(): void {
    this.saveNotice.set('');
    this.selectedDate.set(this.dateKey(new Date()));
    this.expanded.set(false);
    void this.loadData(true);
  }

  async onWeekSaved(result: SavedWeeklySchedule): Promise<void> {
    this.organizerOpen.set(false);
    this.selectedDate.set(result.firstDeadline);
    this.saveNotice.set('Semana guardada. Actualizando el calendario…');
    await this.loadData();
    this.saveNotice.set(this.error()
      ? 'La semana se ha guardado, pero no se pudo actualizar el calendario. Reintenta la carga; no vuelvas a guardar la semana.'
      : 'Semana guardada correctamente.');
  }

  openTaskDetail(task: Task): void {
    if (!this.detailTask()) this.detailTask.set(task);
  }

  onTaskStatusSaved(result: Pick<Task, 'id' | 'todo'>): void {
    this.tasks.update((tasks) => tasks.map((task) => task.id === result.id ? { ...task, todo: result.todo } : task));
    this.detailTask.set(null);
    this.saveNotice.set(result.todo ? 'La tarea vuelve a estar pendiente.' : 'Tarea marcada como completada.');
  }

  async loadData(selectUpcomingDay = false): Promise<void> {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    this.tasks.set([]);
    this.mates.set([]);

    const requestedDate = this.selectedDate();
    const selected = this.parseDate(requestedDate);
    const start = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const end = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);
    // Include adjacent days so boundary weeks and the full month grid stay complete.
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const extraDays = (7 - ((end.getDay() + 6) % 7)) % 7;
    end.setDate(end.getDate() + extraDays);

    try {
      const [tasks, mates] = await Promise.all([
        this.tasksService.getTasksForDateRange(start, end),
        this.matesService.getMates(),
      ]);
      if (requestId !== this.requestId) return;
      this.tasks.set(tasks);
      this.mates.set(mates);
      this.loadedMonth = requestedDate.slice(0, 7);
      if (selectUpcomingDay && this.selectedDate() === requestedDate) {
        const upcomingDay = this.weekDays().find((day) => day.date >= requestedDate && day.taskCount > 0);
        if (upcomingDay) {
          this.selectedDate.set(upcomingDay.date);
          // A week can cross into the next month; load that month before browsing it.
          if (upcomingDay.date.slice(0, 7) !== this.loadedMonth) void this.loadData();
        }
      }
    } catch (error: unknown) {
      if (requestId !== this.requestId) return;
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      this.error.set(code === 'permission-denied'
        ? 'No se ha podido acceder a las tareas o los compañeros.'
        : 'No se pudo cargar el calendario. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }

  selectDate(value: string | string[] | null | undefined): void {
    if (typeof value !== 'string') return;
    const next = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    const parsed = this.parseDate(next);
    if (!Number.isFinite(parsed.getTime()) || this.dateKey(parsed) !== next) return;
    const monthChanged = next.slice(0, 7) !== this.loadedMonth;
    this.selectedDate.set(next);
    if (monthChanged) void this.loadData();
  }

  taskMate(task: Task): Mate | undefined {
    return task.mateId
      ? this.mates().find((mate) => mate.id === task.mateId)
      : this.mates().find((mate) => mate.nombre.toLocaleLowerCase('es') === task.mate.toLocaleLowerCase('es'));
  }

  avatarColor(id: string): string {
    const index = this.mates().findIndex((mate) => mate.id === id);
    return this.avatarColors[Math.max(0, index) % this.avatarColors.length];
  }

  private dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private parseDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
    const label = new Intl.DateTimeFormat('es-ES', options).format(this.parseDate(value));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
}
