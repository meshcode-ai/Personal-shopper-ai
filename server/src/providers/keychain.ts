// OS 키체인 래퍼 — 비밀번호는 반드시 여기를 거쳐서만 저장/조회된다.
// SQLite에는 참조 키(credential_ref)만 남고, 실제 비밀은 macOS Keychain에 산다.
//
// MOCK_KEYCHAIN=1(또는 macOS가 아닌 환경)이면 실제 시스템 키체인을 건드리지 않는
// 파일 기반 스텁을 쓴다 — 스모크테스트/CI/비-macOS 개발 환경용.
// 이 파일은 MEMORY_DIR 아래 생성되고 .gitignore(/memory/)로 커밋에서 제외된다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SERVICE_NAME = "personal-shopper-ai";

function useMock(): boolean {
  return process.env.MOCK_KEYCHAIN === "1" || process.platform !== "darwin";
}

function mockStorePath(): string {
  const dir = process.env.MEMORY_DIR ?? join(process.cwd(), "memory");
  return join(dir, ".keychain-mock.json");
}

function readMockStore(): Record<string, string> {
  const path = mockStorePath();
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeMockStore(store: Record<string, string>): void {
  const path = mockStorePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

export async function setCredential(ref: string, secret: string): Promise<void> {
  if (useMock()) {
    const store = readMockStore();
    store[ref] = secret;
    writeMockStore(store);
    return;
  }
  // -U: 기존 항목이 있으면 갱신 (재등록 시 중복 에러 방지)
  await runSecurity(["add-generic-password", "-a", ref, "-s", SERVICE_NAME, "-w", secret, "-U"]);
}

export async function getCredential(ref: string): Promise<string | null> {
  if (useMock()) return readMockStore()[ref] ?? null;
  try {
    return await runSecurity(["find-generic-password", "-a", ref, "-s", SERVICE_NAME, "-w"]);
  } catch {
    return null;
  }
}

export async function deleteCredential(ref: string): Promise<void> {
  if (useMock()) {
    const store = readMockStore();
    delete store[ref];
    writeMockStore(store);
    return;
  }
  try {
    await runSecurity(["delete-generic-password", "-a", ref, "-s", SERVICE_NAME]);
  } catch {
    // 이미 없으면 성공으로 취급 — 삭제는 멱등해야 한다.
  }
}

async function runSecurity(args: string[]): Promise<string> {
  const proc = Bun.spawn(["security", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`security ${args[0]} 실패: ${stderr.trim()}`);
  return stdout.trim();
}
