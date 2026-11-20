import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  captureLoadedExtensionSource,
  inspectLoadedExtensionSource,
} from "../src/extension-source.ts";

const unavailableReasons = [
  "bundle-path-unsupported",
  "file-missing",
  "read-failed",
  "too-large",
];

test("extension source is current when the loaded file is unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shiori-extension-source-"));
  const sourcePath = join(directory, "extension.ts");
  try {
    await writeFile(sourcePath, "loaded source", "utf8");
    const loaded = captureLoadedExtensionSource(pathToFileURL(sourcePath));
    const diagnostic = inspectLoadedExtensionSource(loaded);

    assert.equal(diagnostic.status, "current");
    assert.equal(diagnostic.capturedSha256, diagnostic.diskSha256);
    assert.match(diagnostic.capturedSha256, /^[0-9a-f]{64}$/);
    assert.match(diagnostic.capturedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
    assert.match(diagnostic.checkedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
    assert.equal("sourcePath" in diagnostic, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("extension source detects content edits, ignores mtime-only changes, and clears after revert", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shiori-extension-source-"));
  const sourcePath = join(directory, "extension.ts");
  const original = "original source";
  try {
    await writeFile(sourcePath, original, "utf8");
    const loaded = captureLoadedExtensionSource(pathToFileURL(sourcePath));

    await utimes(sourcePath, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-02T00:00:00Z"));
    assert.equal(inspectLoadedExtensionSource(loaded).status, "current");

    await writeFile(sourcePath, "edited source", "utf8");
    const changed = inspectLoadedExtensionSource(loaded);
    assert.equal(changed.status, "changed");
    assert.notEqual(changed.capturedSha256, changed.diskSha256);

    await writeFile(sourcePath, original, "utf8");
    const reverted = inspectLoadedExtensionSource(loaded);
    assert.equal(reverted.status, "current");
    assert.equal(reverted.capturedSha256, reverted.diskSha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsupported, missing, unreadable, and oversized sources use only fixed reasons", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shiori-extension-source-"));
  try {
    const unsupported = inspectLoadedExtensionSource(
      captureLoadedExtensionSource("data:text/javascript,not-a-file"),
    );
    assertUnavailable(unsupported, "bundle-path-unsupported");

    const missing = captureLoadedExtensionSource(pathToFileURL(join(directory, "missing.ts")));
    assertUnavailable(inspectLoadedExtensionSource(missing), "file-missing");

    // A directory is a valid file URL but cannot be used as extension source.
    const unreadable = captureLoadedExtensionSource(pathToFileURL(directory));
    assertUnavailable(inspectLoadedExtensionSource(unreadable), "read-failed");

    const oversizedPath = join(directory, "oversized.ts");
    await writeFile(oversizedPath, Buffer.alloc(1024 * 1024 + 1, 0x61));
    const oversized = captureLoadedExtensionSource(pathToFileURL(oversizedPath));
    assertUnavailable(inspectLoadedExtensionSource(oversized), "too-large");

    assert.deepEqual(new Set(unavailableReasons), new Set([
      unsupported.reason,
      "file-missing",
      "read-failed",
      "too-large",
    ]));
    for (const diagnostic of [unsupported, inspectLoadedExtensionSource(missing), inspectLoadedExtensionSource(unreadable), inspectLoadedExtensionSource(oversized)]) {
      assert.equal(diagnostic.status, "unavailable");
      assert.equal(JSON.stringify(diagnostic).includes(directory), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function assertUnavailable(diagnostic, reason) {
  assert.equal(diagnostic.status, "unavailable");
  assert.equal(diagnostic.reason, reason);
  assert.equal(unavailableReasons.includes(diagnostic.reason), true);
}
