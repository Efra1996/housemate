export interface Task {
  id: string;
  task: string;
  mate: string;
  date: Date;
  todo: boolean;
  notes?: string;
  // Older test documents do not yet contain assignment references.
  choreId?: string;
  mateId?: string;
  weekStart?: string;
}
