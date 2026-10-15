import { Component, computed, inject, signal } from '@angular/core';
import { IonAvatar, IonButton, IonCard, IonContent, IonIcon, IonProgressBar, IonRefresher, IonRefresherContent, IonSpinner } from '@ionic/angular';
import type { RefresherCustomEvent } from '@ionic/angular';
import type { Mate } from '../interfaces/mate.interface';
import type { Task } from '../interfaces/task.interface';
import type { Expense } from '../interfaces/expense.interface';
import { ExpensesService } from '../services/expenses.service';
import { formatExpenseAmount } from '../expenses/expense-calculations';
import { TasksService } from '../services/tasks.service';
import { MatesService } from '../services/mates.service';
import { TaskDetailComponent } from '../calendar/task-detail/task-detail.component';
import { addIcons } from 'ionicons';
import { homeOutline, waterOutline, sparklesOutline, basketOutline, checkmarkCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonAvatar, IonButton, IonCard, IonContent, IonIcon, IonProgressBar, IonRefresher, IonRefresherContent, IonSpinner, TaskDetailComponent],
})
export class HomePage {
  private readonly tasksService = inject(TasksService);
  private readonly matesService = inject(MatesService);
  private readonly expensesService = inject(ExpensesService);
  readonly members = signal<Mate[]>([]);
  readonly matesLoading = signal(true);
  readonly matesError = signal<string | null>(null);
  private readonly avatarColors = ['peach', 'sage', 'lavender', 'blue', 'sand'];
  readonly tasks = signal<Task[]>([]);
  readonly tasksLoading = signal(true);
  readonly tasksError = signal<string | null>(null);
  readonly weeklyTasks = computed(() => [
    ...this.tasks().filter((task) => task.todo),
    ...this.tasks().filter((task) => !task.todo),
  ]);
  readonly completedCount = computed(() => this.tasks().filter((task) => !task.todo).length);
  readonly weeklyProgress = computed(() => this.tasks().length ? this.completedCount() / this.tasks().length : 0);
  readonly progressLabel = computed(() => {
    if (this.tasksLoading()) return 'Cargando tareas de esta semana…';
    if (this.tasksError()) return 'No se pudo cargar el progreso semanal.';
    if (!this.tasks().length) return 'Todavía no hay tareas esta semana.';
    return `${this.completedCount()} de ${this.tasks().length} tareas completadas esta semana`;
  });
  readonly detailTask = signal<Task | null>(null);
  readonly detailMember = computed(() => {
    const task = this.detailTask();
    return task ? this.taskMember(task) : undefined;
  });
  readonly detailAvatarColor = computed(() => {
    const member = this.detailMember();
    return member ? this.avatarColor(member.id) : 'peach';
  });

  readonly expenses = signal<Expense[]>([]);
  readonly expensesLoading = signal(true);
  readonly expensesError = signal<string | null>(null);
  readonly recentExpenses = computed(() => this.expenses().slice(0, 4));
  readonly formatAmount = formatExpenseAmount;
  readonly refreshing = signal(false);
  readonly currentDate = signal(new Date());
  readonly currentDateKey = computed(() => {
    const date = this.currentDate();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  readonly currentDateLabel = computed(() => new Intl.DateTimeFormat('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(this.currentDate()));
  private refreshRequest: Promise<void> | null = null;

  constructor() {
    addIcons({ homeOutline, waterOutline, sparklesOutline, basketOutline, checkmarkCircleOutline });
  }

  ionViewWillEnter(): void {
    void this.refresh();
  }

  refresh(): Promise<void> {
    this.currentDate.set(new Date());
    if (this.refreshRequest) return this.refreshRequest;
    this.refreshing.set(true);
    this.refreshRequest = Promise.all([this.loadTasks(), this.loadMates(), this.loadExpenses()])
      .then(() => undefined)
      .finally(() => {
        this.refreshing.set(false);
        this.refreshRequest = null;
      });
    return this.refreshRequest;
  }

  async onPullRefresh(event: RefresherCustomEvent): Promise<void> {
    try {
      await this.refresh();
    } finally {
      await event.target.complete();
    }
  }

  async loadExpenses(): Promise<void> {
    this.expensesLoading.set(true);
    this.expensesError.set(null);
    this.expenses.set([]);
    try {
      this.expenses.set(await this.expensesService.getExpensesFromFirestore());
    } catch {
      this.expensesError.set('No se pudieron cargar los gastos. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      this.expensesLoading.set(false);
    }
  }

  expenseDetail(expense: Expense): string {
    const date = new Intl.DateTimeFormat('es-ES', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(expense.createdAt));
    const payer = this.members().find((member) => member.id === expense.payerId)?.nombre ?? 'Compañero';
    return `${date} · Pagó ${payer} · Entre ${expense.shares.length}`;
  }

  async loadMates(): Promise<void> {
    this.matesLoading.set(true);
    this.matesError.set(null);
    this.members.set([]);
    try {
      this.members.set(await this.matesService.getMates());
    } catch {
      this.matesError.set('No se pudieron cargar los compañeros. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      this.matesLoading.set(false);
    }
  }

  async loadTasks(): Promise<void> {
    this.tasksLoading.set(true);
    this.tasksError.set(null);
    this.tasks.set([]);
    try {
      this.tasks.set(await this.tasksService.getTasksForCurrentWeek());
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'permission-denied') {
        this.tasksError.set('No se ha podido acceder a las tareas. Inténtalo de nuevo más tarde.');
      } else if (code === 'unavailable') {
        this.tasksError.set('No se pudo conectar. Comprueba tu conexión y vuelve a intentarlo.');
      } else if (error instanceof Error && error.message.startsWith('Firebase is not configured.')) {
        this.tasksError.set('Las tareas no están disponibles en este momento. Inténtalo de nuevo más tarde.');
      } else {
        this.tasksError.set('No se pudieron cargar las tareas. Vuelve a intentarlo.');
      }
    } finally {
      this.tasksLoading.set(false);
    }
  }

  taskMember(task: Task): Mate | undefined {
    if (task.mateId) return this.members().find((member) => member.id === task.mateId);
    return this.members().find((member) => member.id === task.mate
      || member.nombre.toLocaleLowerCase('es') === task.mate.toLocaleLowerCase('es'));
  }

  openPendingTask(task: Task): void {
    if (task.todo && !this.detailTask()) this.detailTask.set(task);
  }

  onTaskStatusSaved(result: Pick<Task, 'id' | 'todo'>): void {
    this.tasks.update((tasks) => tasks.map((task) => task.id === result.id ? { ...task, todo: result.todo } : task));
    this.detailTask.set(null);
  }

  avatarColor(id: string): string {
    const index = this.members().findIndex((member) => member.id === id);
    return this.avatarColors[Math.max(0, index) % this.avatarColors.length];
  }

  taskSchedule(task: Task): string {
    return new Intl.DateTimeFormat('es-ES', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(task.date);
  }
}
