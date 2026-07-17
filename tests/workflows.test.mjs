import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const autoReleaseWorkflow = new URL('../.github/workflows/auto-release.yml', import.meta.url);

test('auto-release notes render changelog separator as real newlines', async () => {
  const workflow = await readFile(autoReleaseWorkflow, 'utf8');

  assert.match(workflow, /printf -v NOTES '%s\\n\\n\*\*Full Changelog\*\*/);
  assert.doesNotMatch(workflow, /NOTES="\$\{NOTES\}\\n\\n/);
});
