import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = resolve(root, 'reports');
const apiSurfacePath = resolve(reportsDir, 'api-surface.json');
const jsonOut = resolve(reportsDir, 'openapi.json');
const markdownOut = resolve(reportsDir, 'openapi.md');

function runApiSurface() {
  const completed = spawnSync(process.execPath, [resolve(root, 'scripts', 'api-surface.mjs')], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (completed.status !== 0) {
    const output = [completed.stdout, completed.stderr, completed.error?.message].filter(Boolean).join('\n');
    throw new Error(`api-surface failed:\n${output}`);
  }
}

function toOpenApiPath(expressPath) {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParameters(expressPath) {
  return [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function operationId(route) {
  const suffix = route.path
    .replace(/^\/+/, '')
    .replace(/:([A-Za-z0-9_]+)/g, 'by-$1')
    .split(/[/-]+/)
    .filter(Boolean)
    .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${route.method.toLowerCase()}${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`;
}

function genericBody(route) {
  if (!['POST', 'PUT', 'PATCH'].includes(route.method)) {
    return undefined;
  }
  return {
    required: route.method !== 'PATCH',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
  };
}

function buildSpec(surface) {
  const paths = {};
  for (const route of surface.routes) {
    const openPath = toOpenApiPath(route.path);
    paths[openPath] ||= {};
    const body = genericBody(route);
    paths[openPath][route.method.toLowerCase()] = {
      operationId: operationId(route),
      summary: `${route.method} ${route.path}`,
      tags: [route.path.split('/').filter(Boolean).slice(0, 2).join('/') || 'health'],
      description: `Discovered from ${route.source}. Auth boundary: ${route.protected ? 'JWT bearer token required' : 'public endpoint'}.`,
      ...(route.protected ? { security: [{ bearerAuth: [] }] } : {}),
      parameters: pathParameters(route.path),
      ...(body ? { requestBody: body } : {}),
      responses: {
        200: {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
        ...(route.protected ? { 401: { description: 'Missing or invalid bearer token' } } : {}),
      },
      'x-source-file': route.source,
      'x-auth-boundary': route.protected ? 'protected' : 'public',
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'TeamSync API',
      version: '1.0.0',
      description: 'Generated API contract from the Express route surface inventory.',
    },
    servers: [
      { url: 'http://localhost:5000', description: 'Local development server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    paths,
    'x-generated-from': 'reports/api-surface.json',
  };
}

function buildReport(surface, spec) {
  const operations = Object.values(spec.paths).flatMap((pathItem) => Object.keys(pathItem));
  const protectedOperations = Object.values(spec.paths)
    .flatMap((pathItem) => Object.values(pathItem))
    .filter((operation) => operation['x-auth-boundary'] === 'protected');
  const publicOperations = Object.values(spec.paths)
    .flatMap((pathItem) => Object.values(pathItem))
    .filter((operation) => operation['x-auth-boundary'] === 'public');
  const gates = [
    { name: 'OpenAPI version', ok: spec.openapi === '3.1.0', detail: spec.openapi },
    { name: 'operation count matches API surface', ok: operations.length === surface.summary.routeCount, detail: `${operations.length}/${surface.summary.routeCount}` },
    { name: 'bearer security scheme present', ok: Boolean(spec.components.securitySchemes.bearerAuth), detail: 'components.securitySchemes.bearerAuth' },
    { name: 'protected operations require bearer auth', ok: protectedOperations.every((operation) => Array.isArray(operation.security) && operation.security.length > 0), detail: `${protectedOperations.length} protected operations` },
    { name: 'public operations omit bearer auth', ok: publicOperations.every((operation) => !operation.security), detail: `${publicOperations.length} public operations` },
    { name: 'Express path params converted', ok: Object.keys(spec.paths).every((path) => !path.includes(':')), detail: 'colon params converted to {param}' },
  ];
  return {
    reportType: 'teamsync_openapi_contract',
    generatedAt: new Date().toISOString(),
    ok: gates.every((gate) => gate.ok),
    summary: {
      pathCount: Object.keys(spec.paths).length,
      operationCount: operations.length,
      protectedOperationCount: protectedOperations.length,
      publicOperationCount: publicOperations.length,
    },
    gates,
    referenceBasis: [
      'OpenAPI Specification 3.1 contract document',
      'Bearer authentication boundary expressed as securitySchemes',
      'Generated from local Express route inventory, not hand-maintained text',
    ],
  };
}

function renderMarkdown(report) {
  const lines = [
    '# TeamSync OpenAPI Contract',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: \`${report.ok ? 'OK' : 'FAIL'}\``,
    `Operations: \`${report.summary.operationCount}\``,
    `Protected: \`${report.summary.protectedOperationCount}\``,
    `Public: \`${report.summary.publicOperationCount}\``,
    '',
    '## Gates',
    '',
    '| Gate | Result | Detail |',
    '|---|---|---|',
  ];
  for (const gate of report.gates) {
    lines.push(`| ${gate.name} | ${gate.ok ? 'OK' : 'FAIL'} | ${gate.detail} |`);
  }
  lines.push('', '## Reference Basis', '');
  for (const item of report.referenceBasis) {
    lines.push(`- ${item}`);
  }
  lines.push('', '## Outputs', '', '- `reports/openapi.json`', '- `reports/openapi.md`', '');
  return lines.join('\n');
}

runApiSurface();
const surface = JSON.parse(await readFile(apiSurfacePath, 'utf8'));
const spec = buildSpec(surface);
const report = buildReport(surface, spec);

await mkdir(reportsDir, { recursive: true });
await writeFile(jsonOut, JSON.stringify(spec, null, 2), 'utf8');
await writeFile(markdownOut, renderMarkdown(report), 'utf8');
console.log(JSON.stringify({ ok: report.ok, json: jsonOut, markdown: markdownOut }, null, 2));
if (!report.ok) {
  process.exit(1);
}
