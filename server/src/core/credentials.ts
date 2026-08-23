import type { Database } from "bun:sqlite";
import * as Keychain from "../providers/keychain";
import { getShop } from "./shops";

function refFor(shopId: number): string {
  return `personal-shopper:shop:${shopId}`;
}

export interface CredentialResult {
  hasCredential: true;
  username: string;
}

export async function setShopCredential(
  db: Database,
  shopId: number,
  username: string,
  password: string,
): Promise<CredentialResult> {
  const shop = getShop(db, shopId);
  if (!shop) throw new Error("NOT_FOUND");

  const ref = refFor(shopId);
  await Keychain.setCredential(ref, password);
  db.run(`UPDATE shops SET credential_username = ?, credential_ref = ? WHERE id = ?`, [
    username,
    ref,
    shopId,
  ]);
  return { hasCredential: true, username };
}

export async function removeShopCredential(db: Database, shopId: number): Promise<void> {
  const shop = getShop(db, shopId);
  if (!shop) throw new Error("NOT_FOUND");
  if (shop.credential_ref) await Keychain.deleteCredential(shop.credential_ref);
  db.run(`UPDATE shops SET credential_username = NULL, credential_ref = NULL WHERE id = ?`, [shopId]);
}
