export interface ApiSuccessResponse {
  success: boolean;
  email: string;
}

export interface ApiErrorResponse {
  error: string;
}

export type MarkClearRequest = { email: string };
export type MarkNotHumanRequest = { email: string };
export type RestoreRequest = { email: string };
