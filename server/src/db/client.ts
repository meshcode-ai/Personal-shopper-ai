import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// 프로세스당 하나의 커넥션을 재사용한다. 단, DB_PATH가 바뀌면(테스트가 각자 임시
// 파일을 쓸 때) 새로 연다 — bun:sqlite 커넥션은 파일 경로에 고정되어 있어서다.
let db: Database | null = null;
let cachedPath: string | null = null;

export function getDb(): Database {
  const path = process.env.DB_PATH ?? join(process.cwd(), "data", "personal-shopper.sqlite");
  if (db && cachedPath === path) return db;

  db?.close();

  const dir = dirname(path);
  if (dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(path);
  // PRAGMA는 커넥션 단위 설정이라 새 Database를 열 때마다 다시 걸어야 한다.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);

  cachedPath = path;
  return db;
}

function ensureSchema(database: Database) {
  const schemaPath = join(import.meta.dir, "schema.sql");
  database.exec(readFileSync(schemaPath, "utf-8"));
  migrate(database);
}

// 소규모 컬럼 추가 마이그레이션. 정식 마이그레이션 프레임워크 없이 스키마를 키우는
// 소규모 프로젝트라 idempotent try/catch로 충분하다 — 이미 있으면 SQLite가 던지는
// "duplicate column name" 에러를 무시한다.
function migrate(database: Database) {
  const columns: [string, string][] = [
    ["shops", "logo_url TEXT"],
    ["products", "target_price INTEGER"],
  ];
  for (const [table, def] of columns) {
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
    } catch {
      // 이미 존재 — 무시
    }
  }
}
