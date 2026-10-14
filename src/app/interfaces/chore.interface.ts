export interface Chore {
  id: string;
  title: string;
  eligibleMateIds: string[];
  active: boolean;
}
