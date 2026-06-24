import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverSrc = resolve(root, 'server', 'src');
const entry = resolve(serverSrc, 'index.ts');
const reportsDir = resolve(root, 'reports');
const jsonOut = resolve(reportsDir, 'runtime-boundary.json');
const markdownOut = resolve(reportsDir, 'runtime-boundary.md');

function toRepoPath(path) {
  return relative(root, path).split(sep).join('/');
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractImports(source) {
  const imports = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    resolve(base, 'index.ts')
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function collectRuntimeGraph() {
  const visited = new Set();
  const edges = [];
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const source = await readFile(current, 'utf8');
    for (const specifier of extractImports(source)) {
      const resolved = resolveLocalImport(current, specifier);
      if (!resolved) {
        continue;
      }
      edges.push({
        from: toRepoPath(current),
        to: toRepoPath(resolved),
        specifier
      });
      if (!visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return { modules: [...visited].sort(), edges };
}

function countByTopLevel(files) {
  const counts = new Map();
  for (const file of files) {
    const rel = relative(serverSrc, file).split(sep).join('/');
    const topLevel = rel.includes('/') ? rel.split('/')[0] : '(root)';
    counts.set(topLevel, (counts.get(topLevel) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => a.area.localeCompare(b.area));
}

async function fileIncludes(path, needles) {
  const source = await readFile(path, 'utf8');
  return needles.every((needle) => source.includes(needle));
}

function gate(name, ok, detail) {
  return { name, ok, detail };
}

async function buildReport() {
  const tsconfigPath = resolve(root, 'server', 'tsconfig.json');
  const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'));
  const allTsFiles = (await walk(serverSrc))
    .filter((file) => !toRepoPath(file).includes('/tests/'))
    .sort();
  const graph = await collectRuntimeGraph();
  const runtimeSet = new Set(graph.modules);
  const offGraph = allTsFiles.filter((file) => !runtimeSet.has(file));
  const entrySource = await readFile(entry, 'utf8');
  const routeMounts = [...entrySource.matchAll(/app\.use\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);

  const gates = [
    gate('server entry exists', existsSync(entry), toRepoPath(entry)),
    gate('tsconfig compiles from entry', Array.isArray(tsconfig.include) && tsconfig.include.includes('src/index.ts'), JSON.stringify(tsconfig.include)),
    gate('core API routes mounted', ['/api/auth', '/api/users', '/api/projects', '/api/tasks', '/api/chats', '/api/analytics'].every((route) => routeMounts.includes(route)), routeMounts.join(', ')),
    gate('auth and error middleware imported', await fileIncludes(entry, ['authenticateToken', 'errorHandler']), 'server/src/index.ts'),
    gate('socket runtime wired', await fileIncludes(entry, ['setupSocketIO(io)']), 'server/src/index.ts'),
    gate('runtime graph has enough modules', graph.modules.length >= 10, `${graph.modules.length} modules`)
  ];

  return {
    reportType: 'teamsync_runtime_boundary',
    generatedAt: new Date().toISOString(),
    entry: toRepoPath(entry),
    ok: gates.every((item) => item.ok),
    gates,
    summary: {
      serverSourceFiles: allTsFiles.length,
      runtimeModules: graph.modules.length,
      candidateModules: offGraph.length,
      runtimeEdges: graph.edges.length
    },
    routeMounts,
    runtimeAreas: countByTopLevel(graph.modules),
    candidateAreas: countByTopLevel(offGraph),
    runtimeModules: graph.modules.map(toRepoPath),
    candidateModules: offGraph.map(toRepoPath),
    edges: graph.edges,
    notes: [
      'This report follows static local imports from server/src/index.ts.',
      'Candidate modules are present in source but not reached from the current server entry graph.',
      'A module should move from candidate to runtime only when it is mounted, tested, and documented.'
    ]
  };
}

function renderMarkdown(report) {
  const lines = [
    '# TeamSync Runtime Boundary',
    '',
    `Generated: ${report.generatedAt}`,
    `Entry: \`${report.entry}\``,
    `Status: \`${report.ok ? 'OK' : 'NEEDS REVIEW'}\``,
    '',
    '## Summary',
    '',
    `- Server source files: \`${report.summary.serverSourceFiles}\``,
    `- Runtime modules: \`${report.summary.runtimeModules}\``,
    `- Candidate modules: \`${report.summary.candidateModules}\``,
    `- Runtime import edges: \`${report.summary.runtimeEdges}\``,
    '',
    '## Gates',
    '',
    '| Gate | Result | Detail |',
    '|---|---|---|'
  ];

  for (const item of report.gates) {
    lines.push(`| ${item.name} | ${item.ok ? 'OK' : 'FAIL'} | ${item.detail} |`);
  }

  lines.push('', '## Mounted Routes', '');
  for (const route of report.routeMounts) {
    lines.push(`- \`${route}\``);
  }

  lines.push('', '## Runtime Areas', '', '| Area | Modules |', '|---|---:|');
  for (const item of report.runtimeAreas) {
    lines.push(`| ${item.area} | ${item.count} |`);
  }

  lines.push('', '## Candidate Areas', '', '| Area | Modules |', '|---|---:|');
  for (const item of report.candidateAreas) {
    lines.push(`| ${item.area} | ${item.count} |`);
  }

  lines.push('', '## Boundary Notes', '');
  for (const note of report.notes) {
    lines.push(`- ${note}`);
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
