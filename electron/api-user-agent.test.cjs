const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { isGitLabApiUrl, getApiUserAgent } = require(
  path.resolve(__dirname, 'api-user-agent.ts'),
);

test('matches gitlab.com API requests', () => {
  assert.equal(isGitLabApiUrl('https://gitlab.com/api/v4/projects/1/issues'), true);
});

test('matches self-hosted API requests, including sub-path installs', () => {
  assert.equal(isGitLabApiUrl('https://git.example.org/api/v4/projects?search=x'), true);
  assert.equal(isGitLabApiUrl('https://example.com/gitlab/api/v4/user'), true);
});

test('ignores non-API GitLab and unrelated requests', () => {
  assert.equal(isGitLabApiUrl('https://gitlab.com/group/project/-/issues/1'), false);
  assert.equal(isGitLabApiUrl('https://api.github.com/repos/a/b/issues'), false);
  assert.equal(isGitLabApiUrl('https://example.com/search?q=/api/v4/'), false);
});

test('user agent is non-browser and carries the app version', () => {
  const ua = getApiUserAgent('19.1.0');
  assert.equal(ua, 'SuperProductivity/19.1.0');
  assert.doesNotMatch(ua, /Mozilla/);
});
