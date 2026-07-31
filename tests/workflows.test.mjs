import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const autoReleaseWorkflow = new URL('../.github/workflows/auto-release.yml', import.meta.url);
const packageJson = new URL('../package.json', import.meta.url);
const readme = new URL('../README.md', import.meta.url);

test('auto-release notes render changelog separator as real newlines', async () => {
  const workflow = await readFile(autoReleaseWorkflow, 'utf8');

  assert.match(workflow, /printf -v NOTES '%s\\n\\n\*\*Full Changelog\*\*/);
  assert.doesNotMatch(workflow, /NOTES="\$\{NOTES\}\\n\\n/);
});

test('README install examples match package.json version', async () => {
  const { version } = JSON.parse(await readFile(packageJson, 'utf8'));
  const content = await readFile(readme, 'utf8');

  assert.match(content, new RegExp(`\`${version}\` is the current working release`));
  assert.match(content, new RegExp(`pi install npm:pi-skill-shiori@${version}`));
  assert.match(content, new RegExp(`pi install -l npm:pi-skill-shiori@${version}`));
  assert.match(content, new RegExp(`pi install git:github.com/eiei114/pi-skill-shiori@v${version}`));
});
