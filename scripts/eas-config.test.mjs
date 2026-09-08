import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('keeps production and internal release profiles on native mobile auth', () => {
  const eas = JSON.parse(readFileSync('eas.json', 'utf8'));

  assert.equal(eas.build['internal-ios'].env.EXPO_PUBLIC_AUTH_MODE, 'mobile');
  assert.equal(eas.build['internal-android'].env.EXPO_PUBLIC_AUTH_MODE, 'mobile');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_AUTH_MODE, 'mobile');
});

test('keeps the local development profile on legacy auth', () => {
  const eas = JSON.parse(readFileSync('eas.json', 'utf8'));

  assert.equal(eas.build.development.env.EXPO_PUBLIC_AUTH_MODE, 'legacy');
});
