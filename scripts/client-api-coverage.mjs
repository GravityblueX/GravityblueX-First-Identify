import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = resolve(root, 'client', 'src');
const reportsDir = resolve(root, 'reports');
const openApiPath = resolve(reportsDir, 'openapi.json');
const jsonOut = resolve(reportsDir, 'client-api-coverage.json');
const markdownOut = resolve(reportsDir, 'client-api-coverage.md');

function runOpenApi() {
  const completed = spawnSync(process.execPath, [resolve(root, 'scripts', 'openapi-spec.mjs')], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (completed.status !== 0) {
    const output = [completed.stdout, completed.stderr, completed.error?.message].filter(Boolean).join('\n');
    throw new Error(`openapi generation failed:\n${output}`);
  }
}

async function walk(dir) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', 'dist', 'build'].includes(entry.name)) {
        files.push(...await walk(path));
      }
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function normalizeTemplatePath(raw) {
  return raw
    .replace(/\$\{[^}]+\}/g, '{param}')
    .replace(/\?.*$/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function pathMatches(specPath, clientPath) {
  const specParts = specPath.split('/').filter(Boolean);
  const clientParts = clientPath.split('/').filter(Boolean);
  if (specParts.length !== clientParts.length) return false;
  return specParts.every((part, index) => {
    return /^\{[^}]+\}$/.test(part) || part === clientParts[index];
  });
}

function findOperation(spec, method, path) {
  for (const [specPath, item] of Object.entries(spec.paths || {})) {
    if (!item[method.toLowerCase()]) continue;
    if (pathMatches(specPath, path)) {
      return { path: specPath, operation: item[method.toLowerCase()] };
    }
  }
  return null;
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function discoverCalls(source, file) {
  const calls = [];
  for (const match of source.matchAll(/apiClient\.(get|post|put|delete)(?:<[^>]+>)?\(\s*([`'"])([\s\S]*?)\2/g)) {
    const method = match[1].toUpperCase();
    const path = normalizeTemplatePath(match[3]);
    if (path.startsWith('/api/')) {
      calls.push({
        method,
        path,
        raw: match[3],
        file: relative(root, file),
        line: lineNumber(source, match.index || 0),
        source: 'apiClient',
      });
    }
  }
  for (const match of source.matchAll(/fetch\(\s*([`'"])([\s\S]*?)\1\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g)) {
    const raw = match[2];
    if (!raw.startsWith('/api/')) continue;
    const options = match[3] || '';
    const methodMatch = options.match(/method\s*:\s*['"]([A-Za-z]+)['"]/);
    calls.push({
      method: (methodMatch?.[1] || 'GET').toUpperCase(),
      path: normalizeTemplatePath(raw),
      raw,
      file: relative(root, file),
      line: lineNumber(source, match.index || 0),
      source: 'fetch',
    });
  }
  return calls;
}

function uniqueCalls(calls) {
  const seen = new Map();
  for (const call of calls) {
    const key = `${call.method} ${call.path}`;
    if (!seen.has(key)) {
      seen.set(key, { ...call, occurrences: [] });
    }
    seen.get(key).occurrences.push({ file: call.file, line: call.line, source: call.source, raw: call.raw });
  }
  return [...seen.values()].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function renderMarkdown(report) {
  const lines = [
    '# TeamSync Client API Coverage',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: \`${report.ok ? 'OK' : 'FAIL'}\``,
    `Client calls: \`${report.summary.clientCallCount}\``,
    `Matched calls: \`${report.summary.matchedCallCount}\``,
    `Backend operations: \`${report.summary.backendOperationCount}\``,
    '',
    '## Gates',
    '',
    '| Gate | Result | Detail |',
    '|---|---|---|',
  ];
  for (const gate of report.gates) {
    lines.push(`| ${gate.name} | ${gate.ok ? 'OK' : 'FAIL'} | ${gate.detail} |`);
  }
  lines.push('', '## Client Calls', '', '| Method | Client Path | OpenAPI Match | Locations |', '|---|---|---|---|');
  for (const call of report.calls) {
    const locations = call.occurrences.map((item) => `\`${item.file}:${item.line}\``).join('<br>');
    lines.push(`| ${call.method} | \`${call.path}\` | ${call.matched ? `\`${call.matchedPath}\`` : 'missing'} | ${locations} |`);
  }
  lines.push('', '## Boundary', '');
  lines.push('- This report checks frontend-to-OpenAPI path drift for statically discoverable calls.');
  lines.push('- It does not require every backend route to be called by the frontend.');
  lines.push('');
  return lines.join('\n');
}

if (!existsSync(openApiPath)) {
  runOpenApi();
}

const spec = JSON.parse(await readFile(openApiPath, 'utf8'));
const files = await walk(clientRoot);
const discovered = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  discovered.push(...discoverCalls(source, file));
}

const calls = uniqueCalls(discovered).map((call) => {
  const match = findOperation(spec, call.method, call.path);
  return {
    ...call,
    matched: Boolean(match),
    matchedPath: match?.path || '',
    operationId: match?.operation?.operationId || '',
  };
});

const operations = Object.entries(spec.paths || {}).flatMap(([path, item]) => (
  Object.keys(item).map((method) => ({ method: method.toUpperCase(), path }))
));
const matchedCount = calls.filter((call) => call.matched).length;
const unmatched = calls.filter((call) => !call.matched);
const gates = [
  { name: 'OpenAPI contract available', ok: spec.openapi === '3.1.0', detail: spec.openapi || 'missing' },
  { name: 'client API calls discovered', ok: calls.length >= 18, detail: `${calls.length} call(s)` },
  { name: 'all client calls match OpenAPI', ok: unmatched.length === 0, detail: `${unmatched.length} unmatched` },
  { name: 'analytics direct fetches covered', ok: calls.some((call) => call.path.startsWith('/api/analytics/')), detail: 'client/src/components/dashboard/Analytics.tsx' },
  { name: 'auth flow covered', ok: calls.some((call) => call.method === 'POST' && call.path === '/api/auth/login'), detail: 'POST /api/auth/login' },
];

const report = {
  reportType: 'teamsync_client_api_coverage',
  generatedAt: new Date().toISOString(),
  ok: gates.every((gate) => gate.ok),
  summary: {
    clientCallCount: calls.length,
    matchedCallCount: matchedCount,
    unmatchedCallCount: unmatched.length,
    backendOperationCount: operations.length,
  },
  gates,
  calls,
  unmatched,
  referenceBasis: [
    'OpenAPI Specification as the backend contract',
    'Static frontend call inventory for path drift detection',
    'Coverage is scoped to frontend calls, not full backend feature coverage',
  ],
};

await mkdir(reportsDir, { recursive: true });
await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
await writeFile(markdownOut, renderMarkdown(report), 'utf8');
console.log(JSON.stringify({ ok: report.ok, json: jsonOut, markdown: markdownOut }, null, 2));
if (!report.ok) {
  process.exit(1);
}
