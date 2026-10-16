export type UserPlan = keyof UserQuota;
export interface UserQuota {
  free: number;
  plus: number;
  pro: number;
  purchase: number;
}

export type QuotaType = {
  name: string;
  tooltip: string;
  used: number;
  total: number;
  unit: string;
  resetAt?: number;
};
