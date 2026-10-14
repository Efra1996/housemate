import { Component, inject, signal } from '@angular/core';
import { IonAvatar, IonButton, IonCard, IonContent, IonIcon, IonProgressBar, IonSpinner } from '@ionic/angular';
import type { Mate } from '../interfaces/mate.interface';
import type { Task } from '../interfaces/task.interface';
import { TasksService } from '../services/tasks.service';
import { MatesService } from '../services/mates.service';
import { addIcons } from 'ionicons';
import { homeOutline, waterOutline, sparklesOutline, basketOutline, flashOutline } from 'ionicons/icons';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonAvatar, IonButton, IonCard, IonContent, IonIcon, IonProgressBar, IonSpinner],
})
export class HomePage {
  private readonly tasksService = inject(TasksService);
  private readonly matesService = inject(MatesService);
  readonly members = signal<Mate[]>([]);
  readonly matesLoading = signal(true);
  readonly matesError = signal<string | null>(null);
  private readonly avatarColors = ['peach', 'sage', 'lavender', 'blue', 'sand'];
  readonly tasks = signal<Task[]>([]);
  readonly tasksLoading = signal(true);
  readonly tasksError = signal<string | null>(null);

  // Expenses remain visual examples for now.
  readonly expenses = [
    { id: 'groceries', title: 'Compra del supermercado', detail: '4 oct. · Pagó Efra · Entre 5', amount: '42,50 €', icon: 'basket-outline' },
    { id: 'electricity', title: 'Factura de la luz', detail: '3 oct. · Pagó Dani · Entre 5', amount: '65,00 €', icon: 'flash-outline' },
  ];

  constructor() {
    addIcons({ homeOutline, waterOutline, sparklesOutline, basketOutline, flashOutline });
  }

  ionViewWillEnter(): void {
    void this.loadTasks();
    void this.loadMates();
  }

  async loadMates(): Promise<void> {
    this.matesLoading.set(true);
    this.matesError.set(null);
    this.members.set([]);
    try {
      this.members.set(await this.matesService.getMates());
    } catch {
      this.matesError.set('No se pudieron cargar los compañeros. Comprueba la conexión y los campos nombre y avatar.');
    } finally {
      this.matesLoading.set(false);
    }
  }

  async loadTasks(): Promise<void> {
    this.tasksLoading.set(true);
    this.tasksError.set(null);
    this.tasks.set([]);
    try {
      this.tasks.set(await this.tasksService.getPendingTasksForCurrentWeek());
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'permission-denied') {
        this.tasksError.set('Firestore no permite leer las tareas. Revisa las reglas de acceso de la colección tasks.');
      } else if (code === 'unavailable') {
        this.tasksError.set('No se pudo conectar con Firestore. Comprueba tu conexión y vuelve a intentarlo.');
      } else if (error instanceof Error && error.message.startsWith('Firebase is not configured.')) {
        this.tasksError.set('Falta configurar la clave de Firebase en el archivo de entorno activo.');
      } else {
        this.tasksError.set('No se pudieron cargar las tareas. Revisa la configuración de Firebase y los campos de los documentos.');
      }
    } finally {
      this.tasksLoading.set(false);
    }
  }

  taskMember(task: Task): Mate | undefined {
    return this.members().find((member) => member.id === task.mate
      || member.nombre.toLocaleLowerCase('es') === task.mate.toLocaleLowerCase('es'));
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
