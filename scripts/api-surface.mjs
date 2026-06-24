import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverSrc = resolve(root, 'server', 'src');
const indexPath = resolve(serverSrc, 'index.ts');
const reportsDir = resolve(root, 'reports');
const jsonOut = resolve(reportsDir, 'api-surface.json');
const markdownOut = resolve(reportsDir, 'api-surface.md');

function normalizeRoute(prefix, routePath) {
  const joined = `${prefix.replace(/\/$/, '')}/${routePath.replace(/^\//, '')}`;
  return joined.replace(/\/$/, '') || '/';
}

function extractMounts(indexSource) {
  const importMap = new Map();
  for (const match of indexSource.matchAll(/import\s+(\w+)\s+from\s+['"]\.\/routes\/([^'"]+)['"]/g)) {
    importMap.set(match[1], `routes/${match[2]}.ts`);
  }
  const mounts = [];
  for (const match of indexSource.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:(authenticateToken)\s*,\s*)?(\w+)/g)) {
    mounts.push({
      prefix: match[1],
      protected: Boolean(match[2]),
      importName: match[3],
      file: importMap.get(match[3]) || '',
    });
  }
  return mounts;
}

async function routeEntries(mount) {
  const path = resolve(serverSrc, mount.file);
  if (!mount.file || !existsSync(path)) {
    return [];
  }
  const source = await readFile(path, 'utf8');
  const routes = [];
  for (const match of source.matchAll(/router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g)) {
    routes.push({
      method: match[1].toUpperCase(),
      path: normalizeRoute(mount.prefix, match[2]),
      protected: mount.protected,
      source: `server/src/${mount.file}`,
    });
  }
  return routes;
}

async function buildReport() {
  const indexSource = await readFile(indexPath, 'utf8');
  const mounts = extractMounts(indexSource);
  const routes = (await Promise.all(mounts.map(routeEntries))).flat()
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
  routes.push({
    method: 'GET',
    path: '/health',
    protected: false,
    source: 'server/src/index.ts',
  });
  routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

  const protectedCount = routes.filter((route) => route.protected).length;
  const publicCount = routes.length - protectedCount;
  const gates = [
    { name: 'routes discovered', ok: routes.length >= 10, detail: `${routes.length} routes` },
    { name: 'health endpoint public', ok: routes.some((route) => route.path === '/health' && !route.protected), detail: '/health' },
    { name: 'auth endpoints public', ok: routes.some((route) => route.path === '/api/auth/login' && !route.protected), detail: '/api/auth/login' },
    { name: 'project routes protected', ok: routes.filter((route) => route.path.startsWith('/api/projects')).every((route) => route.protected), detail: '/api/projects/*' },
    { name: 'task routes protected', ok: routes.filter((route) => route.path.startsWith('/api/tasks')).every((route) => route.protected), detail: '/api/tasks/*' },
  ];

  return {
    reportType: 'teamsync_api_surface',
    generatedAt: new Date().toISOString(),
    ok: gates.every((gate) => gate.ok),
    summary: {
      routeCount: routes.length,
      publicCount,
      protectedCount,
      mountedRouters: mounts.length,
    },
    gates,
    routes,
    referenceBasis: [
      'OpenAPI-style API inventory',
      'Express mounted route contract',
      'Repository health gates should be backed by inspectable local artifacts',
    ],
  };
}

function renderMarkdown(report) {
  const lines = [
    '# TeamSync API Surface',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: \`${report.ok ? 'OK' : 'FAIL'}\``,
    `Routes: \`${report.summary.routeCount}\``,
    `Public: \`${report.summary.publicCount}\``,
    `Protected: \`${report.summary.protectedCount}\``,
    '',
    '## Gates',
    '',
    '| Gate | Result | Detail |',
    '|---|---|---|',
  ];
  for (const gate of report.gates) {
    lines.push(`| ${gate.name} | ${gate.ok ? 'OK' : 'FAIL'} | ${gate.detail} |`);
  }
  lines.push('', '## Routes', '', '| Method | Path | Auth | Source |', '|---|---|---|---|');
  for (const route of report.routes) {
    lines.push(`| ${route.method} | \`${route.path}\` | ${route.protected ? 'protected' : 'public'} | \`${route.source}\` |`);
  }
  lines.push('', '## Reference Basis', '');
  for (const item of report.referenceBasis) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  return lines.join('\n');
}

const report = await buildReport();
await mkdir(reportsDir, { recursive: true });
await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
await writeFile(markdownOut, renderMarkdown(report), 'utf8');
console.log(JSON.stringify({ ok: report.ok, json: jsonOut, markdown: markdownOut }, null, 2));
if (!report.ok) {
  process.exit(1);
}
