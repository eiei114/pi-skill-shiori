import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseWorkflow = await readFile(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8");
const publishWorkflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

function assertNoMergeTriggeredRelease(release, publish) {
  const releaseTriggers = release.split("permissions:")[0];
  const publishTriggers = publish.split("permissions:")[0];
  assert.match(releaseTriggers, /on:\r?\n\s+workflow_dispatch:/, "release must be manually triggered only");
  assert.doesNotMatch(releaseTriggers, /^\s+push:/m, "a merge must not start release");
  assert.match(release, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(publishTriggers, /push:\r?\n\s+tags:/, "publishing must remain version-tag gated");
  assert.doesNotMatch(publishTriggers, /branches:|paths:/, "main branch/package edits must not publish");
  assert.match(publishTriggers, /workflow_dispatch:/, "explicit manual publishing remains available");
  assert.match(publish, /npm publish/);
}

test("merging code cannot directly or indirectly trigger npm publish or release", () => {
  assert.doesNotThrow(() => assertNoMergeTriggeredRelease(releaseWorkflow, publishWorkflow));
  assert.throws(() => assertNoMergeTriggeredRelease(releaseWorkflow.replace("  workflow_dispatch:", "  push:\n    branches: [main]\n  workflow_dispatch:"), publishWorkflow));
  assert.throws(() => assertNoMergeTriggeredRelease(releaseWorkflow, publishWorkflow.replace("    tags:", "    branches: [main]\n    tags:")));
});

test("manual release rejects malformed SemVer without leading zeros", () => {
  const pattern = releaseWorkflow.match(/grep -Eq '([^']+)'/)?.[1];
  assert.ok(pattern, "manual release must validate stable SemVer");
  const stableSemver = new RegExp(pattern);
  for (const version of ["0.0.0", "0.6.14", "10.20.300"]) assert.match(version, stableSemver);
  for (const version of ["00.6.14", "0.06.14", "0.6.014", "0.6", "0.6.14-beta"]) assert.doesNotMatch(version, stableSemver);
});
