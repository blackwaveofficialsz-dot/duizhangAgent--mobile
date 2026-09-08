import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('generates types from a local OpenAPI artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mobile-openapi-'));
  const schema = join(directory, 'openapi.json');
  const output = join(directory, 'api.ts');

  await writeFile(
    schema,
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/api/v1/analytics/orders': {
          get: {
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/OrderSummary' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          OrderSummary: {
            type: 'object',
            required: ['orders'],
            properties: { orders: { type: 'integer' } },
          },
        },
      },
    }),
  );

  const result = spawnSync(
    process.execPath,
    ['scripts/generate-api-types.mjs', '--schema', schema, '--output', output],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(output), true, 'generator must honor --output');
  const generated = await readFile(output, 'utf8');
  assert.match(generated, /export interface paths/);
  assert.match(generated, /OrderSummary/);
  assert.match(generated, /orders: number/);
});
