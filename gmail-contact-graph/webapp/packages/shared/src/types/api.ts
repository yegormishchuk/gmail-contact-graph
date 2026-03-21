export interface ApiSuccessResponse {
  success: boolean;
  email: string;
}

export interface ApiErrorResponse {
  error: string;
}

export interface SpamStats {
  excludedCount: number;
  excludedTotal: number;
}

export type MarkClearRequest = { email: string };
export type MarkNotHumanRequest = { email: string };
export type RestoreRequest = { email: string };
