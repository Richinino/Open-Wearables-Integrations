export interface AccountSettings {
  theme: "system" | "light" | "dark";
  sleep_score: "performance" | "apple" | "samsung";
  overview_mode: "auto" | "morning";
}
export interface Account {
  id: string;
  email: string;
  first_name: string;
  last_name: string | null;
  role: "admin" | "user";
  status: "pending" | "active" | "suspended";
  paired: boolean;
  birth_date: string | null;
  sex: "male" | "female" | null;
  training_consent: boolean;
  settings: AccountSettings;
  has_samsung: boolean;
  created_at: string;
  last_login_at: string | null;
  session_version: number;
}
export interface AccountAdmin extends Account { ow_user_id: string | null; last_data_at: string | null }
export interface SessionClaims { a: string; r: "admin" | "user"; v: number; x: string | null; p: boolean; e: number }
export interface AccountSession { account: Account; claims: SessionClaims }
export interface OwUser { id: string; label: string; paired_account_id: string | null }
export interface AccountSources {
  connections: Array<{ provider: string; status?: string; last_sync_at?: string | null; [key: string]: unknown }>;
  types: Array<{ [key: string]: unknown }>;
  updated_at: string | null;
}
export interface InboxItem { id: number; kind: string; account_id: string | null; message: string; created_at: string; resolved_at: string | null }
export interface SystemStatus {
  ow_api: "ok" | "down";
  ow_version: string | null;
  ow_latest: string | null;
  last_sync_at: string | null;
  funnel: { last_event_at: string | null; last_event: string | null };
  registration_open: boolean;
}
