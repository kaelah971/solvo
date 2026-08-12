export type DatabaseConfigErrorCode = "no_url" | "invalid_url";

export class DatabaseConfigError extends Error {
  readonly code: DatabaseConfigErrorCode;

  constructor(code: DatabaseConfigErrorCode, message: string) {
    super(message);
    this.name = "DatabaseConfigError";
    this.code = code;
  }
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (url.trim().length === 0) {
    throw new DatabaseConfigError(
      "no_url",
      "DATABASE_URL is missing. Copy .env.example to .env and set DATABASE_URL to a Postgres connection string (Supabase pooler or local).",
    );
  }
  const trimmed = url.trim();
  if (!trimmed.startsWith("postgres://") && !trimmed.startsWith("postgresql://")) {
    throw new DatabaseConfigError(
      "invalid_url",
      "DATABASE_URL must be a Postgres connection string starting with postgres:// or postgresql://.",
    );
  }
  return trimmed;
}
