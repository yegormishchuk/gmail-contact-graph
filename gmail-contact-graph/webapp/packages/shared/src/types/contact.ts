export interface Contact {
  name: string;
  email: string;
  received_count: number;
  sent_count: number;
  total_count: number;
  meetings_count: number;
}

export interface ExcludedContact {
  name: string;
  email: string;
  received: number;
  sent: number;
  total: number;
}
