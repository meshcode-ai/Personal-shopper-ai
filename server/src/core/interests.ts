import type { Database } from "bun:sqlite";
import { readProfile, writeProfile } from "../memory/store";
import { analyzeInterests, type PurchaseForAnalysis } from "../providers/qwen";
import { listPurchasesForShop } from "./purchases";
import { listShops } from "./shops";

export interface Interest {
  id: number;
  tag: string;
  score: number;
  evidence: string | null;
  updated_at: string;
}

export function listInterests(db: Database): Interest[] {
  return db.query("SELECT * FROM interests ORDER BY score DESC").all() as Interest[];
}

export async function runAnalysis(db: Database) {
  const purchases: PurchaseForAnalysis[] = listShops(db).flatMap((shop) =>
    listPurchasesForShop(db, shop.id).map((p) => ({
      item_name: p.item_name,
      price: p.price,
      quantity: p.quantity,
      bought_at: p.bought_at,
    })),
  );

  const previousProfile = readProfile();
  const { interests, profileMarkdown } = await analyzeInterests(purchases, previousProfile);

  const upsert = db.prepare(
    `INSERT INTO interests (tag, score, evidence, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(tag) DO UPDATE SET score = excluded.score, evidence = excluded.evidence, updated_at = excluded.updated_at`,
  );
  for (const interest of interests) {
    upsert.run(interest.tag, interest.score, interest.evidence);
  }

  writeProfile(profileMarkdown);

  return { interests: listInterests(db), profileMarkdown };
}
