import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { OnChanges, SimpleChanges } from '@angular/core';
import {
  IonAvatar, IonButton, IonButtons, IonContent, IonFooter, IonHeader,
  IonIcon, IonModal, IonSpinner, IonTextarea, IonTitle, IonToggle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import type { Mate } from '../../interfaces/mate.interface';
import type { Task } from '../../interfaces/task.interface';
import { TasksService } from '../../services/tasks.service';

@Component({
  selector: 'app-task-detail',
  templateUrl: './task-detail.component.html',
  styleUrls: ['./task-detail.component.scss'],
  imports: [IonAvatar, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonModal, IonSpinner, IonTextarea, IonTitle, IonToggle, IonToolbar],
})
export class TaskDetailComponent implements OnChanges {
  readonly task = input<Task | null>(null);
  readonly mate = input<Mate | undefined>();
  readonly avatarColor = input('peach');
  readonly previousTask = input<Task | undefined>();
  readonly previousNotesLoading = input(false);
  readonly previousNotesError = input<string | null>(null);
  readonly retryPreviousNotes = output<void>();
  readonly dismissed = output<void>();
  readonly saved = output<Pick<Task, 'id' | 'todo' | 'notes'>>();

  readonly completed = signal(false);
  readonly notes = signal('');
  readonly notesToSave = computed(() => this.completed() ? this.notes().trim() : (this.task()?.notes ?? ''));
  readonly saving = signal(false);
  readonly error = signal('');
  private readonly confirmed = signal(false);
  private readonly tasksService = inject(TasksService);

  readonly canSave = computed(() => {
    const task = this.task();
    return !!task && (this.completed() !== !task.todo || this.notesToSave() !== (task.notes ?? ''))
      && this.notesToSave().length <= 500 && !this.saving() && !this.confirmed();
  });
  readonly deadlineLabel = computed(() => {
    const task = this.task();
    return task ? new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(task.date) : '';
  });
  readonly previousWeekLabel = computed(() => {
    const week = this.previousTask()?.weekStart;
    return week ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(`${week}T00:00:00`)) : '';
  });
  readonly deadlineKey = computed(() => {
    const date = this.task()?.date;
    return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
  });

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['task']) {
      this.completed.set(this.task() ? !this.task()?.todo : false);
      this.notes.set(this.task()?.notes ?? '');
      this.error.set('');
      this.confirmed.set(false);
    }
  }

  changeCompleted(checked: boolean): void {
    if (this.saving()) return;
    this.completed.set(checked);
    this.error.set('');
  }

  close(): void {
    if (!this.saving()) this.dismissed.emit();
  }

  async save(): Promise<void> {
    const task = this.task();
    if (!task || !this.canSave()) return;
    const todo = !this.completed();
    const notes = this.notesToSave();
    this.saving.set(true);
    this.error.set('');
    try {
      await this.tasksService.updateTaskStatus(task.id, todo, notes);
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      this.error.set(code === 'not-found'
        ? 'La tarea ya no existe. Cierra esta ventana y vuelve a cargar el calendario.'
        : 'No se pudo confirmar el cambio. Tu selección se mantiene; comprueba la conexión y vuelve a intentarlo.');
      return;
    } finally {
      this.saving.set(false);
    }
    this.confirmed.set(true);
    this.saved.emit({ id: task.id, todo, notes });
  }
}
