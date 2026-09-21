import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { DEFAULT_INDEX_GRACE_MS, buildSkillIndex, pruneStaleIndexFiles } = await import("../src/indexer.js");
const { loadPolicy } = await import("../src/policy.js");

async function tempCacheDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "shiori-index-prune-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

async function writeAgedFile(path, content, ageMs) {
  await writeFile(path, content, "utf8");
  const stamp = new Date(Date.now() - ageMs);
  await utimes(path, stamp, stamp);
}

test("prunes index databases older than the grace window", async (t) => {
  const dir = await tempCacheDir(t);
  const longAgo = DEFAULT_INDEX_GRACE_MS * 4;

  await writeAgedFile(join(dir, "index-111-111.sqlite"), "old", longAgo);
  await writeAgedFile(join(dir, "index-111-111.sqlite-wal"), "old-sidecar", longAgo);
  await writeAgedFile(join(dir, "index-222-222.sqlite"), "fresh", 0);
  await writeAgedFile(join(dir, "index-333-333.sqlite"), "current", longAgo);
  await writeAgedFile(join(dir, "index.sqlite"), "legacy", longAgo);
  await writeAgedFile(join(dir, "unrelated.txt"), "keep me", longAgo);

  const removed = await pruneStaleIndexFiles(dir, { keep: "index-333-333.sqlite" });

  assert.deepEqual(removed.sort(), ["index-111-111.sqlite", "index-111-111.sqlite-wal"]);
  const remaining = (await readdir(dir)).sort();
  assert.deepEqual(remaining, ["index-222-222.sqlite", "index-333-333.sqlite", "index.sqlite", "unrelated.txt"]);
});

test("keeps fresh databases so a concurrent process keeps its index", async (t) => {
  const dir = await tempCacheDir(t);
  await writeAgedFile(join(dir, "index-444-444.sqlite"), "live", DEFAULT_INDEX_GRACE_MS / 4);

  const removed = await pruneStaleIndexFiles(dir);

  assert.deepEqual(removed, []);
  assert.deepEqual(await readdir(dir), ["index-444-444.sqlite"]);
});

test("skips entries it cannot remove instead of failing the build", async (t) => {
  const dir = await tempCacheDir(t);
  await mkdir(join(dir, "index-555-555.sqlite"), { recursive: true });
  const stamp = new Date(Date.now() - DEFAULT_INDEX_GRACE_MS * 4);
  await utimes(join(dir, "index-555-555.sqlite"), stamp, stamp);

  const removed = await pruneStaleIndexFiles(dir);

  assert.deepEqual(removed, []);
  assert.deepEqual(await readdir(dir), ["index-555-555.sqlite"]);
});

test("returns an empty list when the cache directory does not exist", async (t) => {
  const dir = await tempCacheDir(t);
  const removed = await pruneStaleIndexFiles(join(dir, "missing"));
  assert.deepEqual(removed, []);
});

test("buildSkillIndex prunes earlier databases for the same vault", async (t) => {
  const cwd = await tempCacheDir(t);
  const cacheDir = join(cwd, ".pi", "cache", "skill-shiori");
  await mkdir(cacheDir, { recursive: true });
  await writeAgedFile(join(cacheDir, "index-999-999.sqlite"), "stale", DEFAULT_INDEX_GRACE_MS * 4);

  const policy = await loadPolicy(cwd);
  const index = await buildSkillIndex(cwd, [], policy);
  index.close?.();

  const remaining = await readdir(cacheDir);
  assert.equal(remaining.includes("index-999-999.sqlite"), false, "stale database should be removed");
  assert.equal(remaining.length, 1);
  assert.match(remaining[0], /^index-\d+-\d+\.sqlite$/);
});
