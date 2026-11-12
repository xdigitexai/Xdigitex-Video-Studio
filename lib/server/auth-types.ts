export interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string | null;
  display_name: string;
  role: string;
  status: string;
  email_verified_at: number | null;
  legacy_owner_id: string | null;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

export type Role = "super_admin" | "admin" | "customer";

export interface Actor {
  user: UserRow;
  via: "session" | "platform_header";
}

export interface AuthConfig {
  platformAuthEnabled: boolean;
  adminEmails: string[];
  sessionDays: number;
}
