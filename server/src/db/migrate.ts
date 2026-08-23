// bun run db:migrate — 스키마를 명시적으로 적용해두고 싶을 때 쓰는 CLI.
// getDb()가 어차피 첫 접근 시 스키마를 보장하므로 필수는 아니지만,
// "DB 파일이 잘 만들어졌는지" 배포 전에 눈으로 확인할 때 쓴다.
import { getDb } from "./client";

const db = getDb();
const path = process.env.DB_PATH ?? "./data/personal-shopper.sqlite";
const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all();

console.log(`✅ schema ready → ${path}`);
console.log(`   tables: ${tables.map((t: any) => t.name).join(", ")}`);
db.close();
