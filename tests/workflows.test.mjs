import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const autoReleaseWorkflow = new URL('../.github/workflows/auto-release.yml', import.meta.url);
const ciWorkflow = new URL('../.github/workflows/ci.yml', import.meta.url);
const changelog = new URL('../CHANGELOG.md', import.meta.url);
const roadmap = new URL('../ROADMAP.md', import.meta.url);
const packageJson = new URL('../package.json', import.meta.url);
const readme = new URL('../README.md', import.meta.url);

function compareSemver(a, b) {
  const va = a.split('.').map(Number);
  const vb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] - vb[i];
  }
  return 0;
}

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

test('CHANGELOG documents the current package version', async () => {
  const { version } = JSON.parse(await readFile(packageJson, 'utf8'));
  const content = await readFile(changelog, 'utf8');

  assert.match(content, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
});

test('CI runs version:check on pull requests', async () => {
  const workflow = await readFile(ciWorkflow, 'utf8');

  assert.match(workflow, /if: github\.event_name == 'pull_request'/);
  assert.match(workflow, /npm run version:check/);
});

test('ROADMAP reflects shipped version:check CI gate', async () => {
  const content = await readFile(roadmap, 'utf8');

  assert.match(
    content,
    /\| 2 \| Add `version:check` CI gate \(validate semver and CHANGELOG policy on pull requests\) \| none \| done \|/,
  );
  assert.match(content, /- \[x\] \*\*`version:check` CI gate\*\*/);
});

test('CHANGELOG Unreleased has no stale version references', async () => {
  const { version: current } = JSON.parse(await readFile(packageJson, 'utf8'));
  const content = await readFile(changelog, 'utf8');
  const unreleasedMatch = content.match(/^## Unreleased\r?\n([\s\S]*?)(?=\r?\n## \[)/m);
  assert.ok(
    unreleasedMatch,
    'CHANGELOG must contain an ## Unreleased section before the first release heading',
  );
  const unreleased = unreleasedMatch[1];

  for (const match of unreleased.matchAll(/\d+\.\d+\.\d+/g)) {
    const mentioned = match[0];
    assert.ok(
      compareSemver(mentioned, current) > 0,
      `Unreleased still references stale version ${mentioned}; current is ${current}`,
    );
  }
});
