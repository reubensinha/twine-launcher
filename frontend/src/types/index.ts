/** Matches backend Pydantic schemas exactly. */

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'player';
  is_active: boolean;
  autosave_enabled: boolean;
  created_at: string;
}

export interface Game {
  id: number;
  name: string;
  format: string;
  file_path: string;
  description: string | null;
  cover_image: string | null;
  source: 'local' | 'git';
  source_url: string | null;
  created_at: string;
}

export interface GameCreate {
  name: string;
  format: string;
  file_path: string;
  description?: string;
  cover_image?: string;
  source?: 'local' | 'git';
  source_url?: string;
}

export interface GameUpdate {
  name?: string;
  format?: string;
  file_path?: string;
  description?: string;
  cover_image?: string;
}

export interface SaveData {
  game_id: number;
  user_id: number;
  data: Record<string, string>;
  updated_at: string;
}

export interface GameSession {
  id: number;
  game_id: number;
  game_name: string;
  user_id: number;
  username: string;
  started_at: string;
}

export interface UserCreate {
  username: string;
  password: string;
  role: 'admin' | 'player';
}

export interface UserUpdate {
  username?: string;
  password?: string;
  role?: 'admin' | 'player';
  is_active?: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface BackupImportResult {
  saves_restored: number;
  games_restored: number;
  errors: string[];
}

export interface ApiError {
  detail: string;
}
