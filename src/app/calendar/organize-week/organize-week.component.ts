import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { OnChanges, SimpleChanges } from '@angular/core';
import {
  IonAvatar, IonButton, IonButtons, IonCard, IonCheckbox, IonContent,
  IonFooter, IonHeader, IonIcon, IonInput, IonItem, IonList,
  IonModal, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import type { Mate } from '../../interfaces/mate.interface';
import type { Chore } from '../../interfaces/chore.interface';
import type { Task } from '../../interfaces/task.interface';
import type { SavedWeeklySchedule, SkippedChore, WeeklyAssignment, WeeklySchedule } from '../../interfaces/weekly-schedule.interface';
import { ChoresService } from '../../services/chores.service';
import { TasksService } from '../../services/tasks.service';
import { generateWeeklySchedule, validateWeeklySchedule } from '../../services/weekly-scheduler';

@Component({
  selector: 'app-organize-week',
  templateUrl: './organize-week.component.html',
  styleUrls: ['./organize-week.component.scss'],
  imports: [IonAvatar, IonButton, IonButtons, IonCard, IonCheckbox, IonContent, IonFooter, IonHeader, IonIcon, IonInput, IonItem, IonList, IonModal, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar],
})
export class OrganizeWeekComponent implements OnChanges {
  readonly isOpen = input(false);
  readonly mates = input<readonly Mate[]>([]);
  readonly initialDate = input('');
  readonly dismissed = output<void>();
  readonly saved = output<SavedWeeklySchedule>();

  readonly step = signal<'availability' | 'review'>('availability');
  readonly weekDate = signal('');
  readonly selectedIds = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly existingWeek = signal(false);
  readonly loaded = signal(false);
  readonly proposal = signal<WeeklySchedule | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal('');
  private readonly fieldErrors = signal<Record<string, string>>({});
  readonly editError = computed(() => Object.values(this.fieldErrors())[0] ?? '');
  private readonly savedSuccessfully = signal(false);
  private readonly choresService = inject(ChoresService);
  private readonly tasksService = inject(TasksService);
  private readonly chores = signal<Chore[]>([]);
  private history: Task[] = [];
  private requestId = 0;
  private readonly avatarColors = ['peach', 'sage', 'lavender', 'blue', 'sand'];

  readonly canGenerate = computed(() => this.loaded() && !this.loading() && !this.saving() && !this.error() && !this.existingWeek());
  readonly workloadError = computed(() => {
    const proposal = this.proposal();
    if (!proposal || proposal.status !== 'ready') return '';
    return validateWeeklySchedule(proposal, {
      weekStart: this.week().start, mates: this.mates(), chores: this.chores(),
      availableMateIds: this.selectedIds(), history: [],
    });
  });
  readonly canSave = computed(() => this.canGenerate() && this.step() === 'review'
    && this.proposal()?.status === 'ready' && !this.editError() && !this.workloadError() && !this.savedSuccessfully());
  readonly availableMates = computed(() => this.mates().filter((mate) => this.selectedIds().includes(mate.id)));
  readonly allSelected = computed(() => this.mates().length > 0 && this.availableMates().length === this.mates().length);
  readonly partiallySelected = computed(() => this.availableMates().length > 0 && !this.allSelected());
  readonly week = computed(() => {
    const start = this.parseDate(this.weekDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: this.dateKey(start), end: this.dateKey(end) };
  });
  readonly weekLabel = computed(() => {
    const { start, end } = this.week();
    const format = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    return `Del ${format.format(this.parseDate(start))} al ${format.format(this.parseDate(end))}`;
  });

  constructor() {
    addIcons({ closeOutline });
    this.weekDate.set(this.dateKey(new Date()));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue === true) {
      this.savedSuccessfully.set(false);
      this.step.set('availability');
      this.weekDate.set(this.validDate(this.initialDate()) ? this.initialDate() : this.dateKey(new Date()));
      this.selectedIds.set(this.mates().map((mate) => mate.id));
      void this.loadInputs();
    } else if (changes['isOpen']?.currentValue === false) {
      this.requestId += 1;
      this.loading.set(false);
    }
  }

  toggleAll(checked: boolean): void {
    if (this.saving()) return;
    this.selectedIds.set(checked ? this.mates().map((mate) => mate.id) : []);
    this.resetPreview();
  }

  toggleMate(id: string, checked: boolean): void {
    if (this.saving()) return;
    this.selectedIds.update((ids) => checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id));
    this.resetPreview();
  }

  changeWeek(value: string | number | null | undefined): void {
    if (this.saving()) return;
    if (!this.validDate(value)) return;
    const previousWeek = this.week().start;
    this.weekDate.set(value);
    if (previousWeek !== this.week().start && this.isOpen()) void this.loadInputs();
  }

  async loadInputs(): Promise<void> {
    if (this.saving()) return;
    const request = ++this.requestId;
    const { start } = this.week();
    this.resetPreview();
    this.loading.set(true);
    this.loaded.set(false);
    this.error.set('');
    this.existingWeek.set(false);
    try {
      const data = await this.readInputs(start);
      if (request !== this.requestId) return;
      this.chores.set(data.chores);
      this.history = data.tasks.filter((task) => task.weekStart !== start);
      this.existingWeek.set(data.tasks.some((task) => task.weekStart === start) || data.legacyTasks.length > 0);
      this.loaded.set(true);
    } catch {
      if (request === this.requestId) this.error.set('No se pudieron cargar las tareas y el historial. Inténtalo de nuevo.');
    } finally {
      if (request === this.requestId) this.loading.set(false);
    }
  }

  generatePreview(): void {
    if (!this.canGenerate()) return;
    try {
      this.proposal.set(generateWeeklySchedule({
        weekStart: this.week().start, mates: this.mates(), availableMateIds: this.selectedIds(),
        chores: this.chores(), history: this.history,
      }));
      this.fieldErrors.set({});
      this.saveError.set('');
      this.step.set('review');
    } catch {
      this.error.set('No se pudo generar la propuesta. Revisa la disponibilidad y las tareas configuradas.');
    }
  }

  eligibleMates(choreId: string): readonly Mate[] {
    const chore = this.chores().find((entry) => entry.id === choreId);
    return this.availableMates().filter((mate) => chore?.eligibleMateIds.includes(mate.id));
  }

  changeAssignee(choreId: string, value: unknown): void {
    if (this.saving()) return;
    const mate = this.eligibleMates(choreId).find((entry) => entry.id === value);
    if (!mate) {
      this.setFieldError(`${choreId}:mate`, 'El responsable debe estar disponible y poder realizar esta tarea.');
      return;
    }
    this.setFieldError(`${choreId}:mate`, '');
    this.updateAssignment(choreId, { mateId: mate.id, mate: mate.nombre });
  }

  changeDeadline(choreId: string, value: string | number | null | undefined): void {
    if (this.saving()) return;
    if (!this.validDate(value) || value < this.week().start || value > this.week().end) {
      this.setFieldError(`${choreId}:date`, 'La fecha límite debe estar dentro de la semana seleccionada.');
      return;
    }
    this.setFieldError(`${choreId}:date`, '');
    this.updateAssignment(choreId, { date: this.parseDate(value) });
  }

  async savePreview(): Promise<void> {
    const proposal = this.proposal();
    if (!this.canSave() || !proposal) return;
    this.saving.set(true);
    this.saveError.set('');
    try {
      await this.tasksService.saveWeeklySchedule(proposal, this.selectedIds());
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'week-already-organized') {
        this.existingWeek.set(true);
        this.saveError.set('La semana ya tiene tareas asignadas. No se ha sustituido ningún dato.');
      } else {
        this.saveError.set('No se pudo confirmar el guardado. Comprueba la conexión e inténtalo de nuevo.');
      }
      return;
    } finally {
      this.saving.set(false);
    }
    this.savedSuccessfully.set(true);
    const firstDeadline = proposal.assignments.map((task) => this.deadline(task)).sort()[0];
    this.saved.emit({ weekStart: proposal.weekStart, firstDeadline });
    this.dismissed.emit();
  }

  changeAvailability(): void {
    if (!this.saving()) this.step.set('availability');
  }

  deadline(assignment: WeeklyAssignment): string {
    return this.dateKey(assignment.date);
  }

  skippedTitle(choreId: string): string {
    return this.chores().find((chore) => chore.id === choreId)?.title ?? choreId;
  }

  skippedReason(reason: SkippedChore['reason']): string {
    const labels: Record<SkippedChore['reason'], string> = {
      inactive: 'La tarea está inactiva.',
      'no-eligible-mate': 'No hay compañeros disponibles que puedan realizarla.',
      'availability-policy': 'Se omite según el reparto para esta disponibilidad.',
      'no-valid-assignment': 'No se puede repartir respetando las reglas de carga.',
    };
    return labels[reason];
  }

  private async readInputs(start: string): Promise<{ chores: Chore[]; tasks: Task[]; legacyTasks: Task[] }> {
    const end = this.parseDate(start);
    end.setDate(end.getDate() + 7);
    const historyStart = this.parseDate(start);
    historyStart.setDate(historyStart.getDate() - 28);
    const [chores, tasks, datedTasks] = await Promise.all([
      this.choresService.getActiveChores(),
      this.tasksService.getTasksForWeekRange(this.dateKey(historyStart), this.dateKey(end)),
      this.tasksService.getTasksForDateRange(this.parseDate(start), end),
    ]);
    return { chores, tasks, legacyTasks: datedTasks.filter((task) => !task.weekStart) };
  }

  private updateAssignment(choreId: string, changes: Partial<Pick<WeeklyAssignment, 'mateId' | 'mate' | 'date'>>): void {
    this.saveError.set('');
    this.proposal.update((proposal) => proposal ? {
      ...proposal, assignments: proposal.assignments.map((assignment) => assignment.choreId === choreId
        ? { ...assignment, ...changes } : assignment),
    } : null);
  }

  private setFieldError(key: string, message: string): void {
    this.fieldErrors.update((errors) => {
      const updated = { ...errors };
      if (message) updated[key] = message;
      else delete updated[key];
      return updated;
    });
  }

  private resetPreview(): void {
    this.proposal.set(null);
    this.fieldErrors.set({});
    this.saveError.set('');
    this.step.set('availability');
  }

  private validDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = this.parseDate(value);
    return Number.isFinite(date.getTime()) && this.dateKey(date) === value;
  }

  avatarColor(index: number): string {
    return this.avatarColors[index % this.avatarColors.length];
  }

  private parseDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
