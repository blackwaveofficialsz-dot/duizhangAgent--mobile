import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

const mobileRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const defaultOutput = fileURLToPath(new URL('../src/types/generated/api.ts', import.meta.url));

const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    schema: { type: 'string' },
    url: { type: 'string' },
  },
});

const schemaPath = values.schema ?? process.env.OPENAPI_SCHEMA;
const schemaUrl = values.url ?? process.env.OPENAPI_URL;

if (schemaPath && schemaUrl) {
  throw new Error('Use only one OpenAPI source: --schema/OPENAPI_SCHEMA or --url/OPENAPI_URL.');
}

const schema = await loadSchema();
const ast = await openapiTS(schema, { alphabetize: true, silent: true });
const output = values.output ? resolve(values.output) : defaultOutput;

await writeFile(output, COMMENT_HEADER + astToString(ast));

async function loadSchema() {
  if (schemaPath) {
    return JSON.parse(await readFile(resolve(schemaPath), 'utf8'));
  }

  if (schemaUrl) {
    const response = await fetch(schemaUrl);
    if (!response.ok) {
      throw new Error(`Failed to read OpenAPI schema from ${schemaUrl}: HTTP ${response.status}`);
    }
    return response.json();
  }

  const python = [
    'import json',
    'from src.app.main import app',
    "print(json.dumps(app.openapi(), ensure_ascii=False, sort_keys=True, separators=(',', ':')))",
  ].join('; ');
  const uvArgs = ['run', '--frozen', 'python', '-c', python];
  const translated = isRosetta();

  try {
    const contents = execFileSync(translated ? 'arch' : 'uv', translated ? ['-arm64', 'uv', ...uvArgs] : uvArgs, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'test',
        JWT_SECRET_KEY: process.env.JWT_SECRET_KEY ?? 'test-secret-for-ci',
      },
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Failed to generate OpenAPI from the local FastAPI app. Run from ${mobileRoot} with uv and the frozen backend environment available, or set OPENAPI_SCHEMA/OPENAPI_URL.`,
      { cause: error },
    );
  }
}

function isRosetta() {
  if (process.platform !== 'darwin' || process.arch !== 'x64') return false;
  try {
    return execFileSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' }).trim() === '1';
  } catch {
    return false;
  }
}
