import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = resolve(root, 'reports');
const jsonOut = resolve(reportsDir, 'release-readiness.json');
const markdownOut = resolve(reportsDir, 'release-readiness.md');
const runChecks = process.argv.includes('--run-checks');

function gate(name, ok, detail) {
  return { name, ok, detail };
}

function run(command, args) {
  const useCmd = process.platform === 'win32' && command === 'npm';
  const executable = useCmd ? process.env.ComSpec || 'cmd.exe' : command;
  const commandArgs = useCmd ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args;
  const completed = spawnSync(executable, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false
  });
  const output = [completed.stdout, completed.stderr, completed.error?.message].filter(Boolean).join('\n').trim();
  return {
    command: [command, ...args].join(' '),
    exitCode: completed.status ?? 1,
    output: output.slice(-4000)
  };
}

async function fileIncludes(relativePath, needles) {
  const content = await readFile(resolve(root, relativePath), 'utf8');
  return needles.every((needle) => content.includes(needle));
}

async function buildReport() {
  const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const gates = [];

  for (const file of ['README.md', 'LICENSE', 'SECURITY.md', 'renovate.json', 'package-lock.json', 'turbo.json', 'scripts/api-surface.mjs', 'scripts/openapi-spec.mjs', 'scripts/dependency-sbom.mjs', 'scripts/runtime-boundary.mjs']) {
    gates.push(gate(`required file ${file}`, existsSync(resolve(root, file)), file));
  }

  for (const workspace of ['client', 'server', 'shared']) {
    gates.push(gate(`workspace package ${workspace}`, existsSync(resolve(root, workspace, 'package.json')), workspace));
  }

  gates.push(gate('build script present', rootPackage.scripts?.build === 'turbo build', rootPackage.scripts?.build || 'missing'));
  gates.push(gate('test script present', rootPackage.scripts?.test === 'turbo test', rootPackage.scripts?.test || 'missing'));
  gates.push(gate('api surface script present', rootPackage.scripts?.['api:surface'] === 'node scripts/api-surface.mjs', rootPackage.scripts?.['api:surface'] || 'missing'));
  gates.push(gate('openapi script present', rootPackage.scripts?.['api:openapi'] === 'node scripts/openapi-spec.mjs', rootPackage.scripts?.['api:openapi'] || 'missing'));
  gates.push(gate('dependency SBOM script present', rootPackage.scripts?.['deps:sbom'] === 'node scripts/dependency-sbom.mjs', rootPackage.scripts?.['deps:sbom'] || 'missing'));
  gates.push(gate('runtime boundary script present', rootPackage.scripts?.['runtime:boundary'] === 'node scripts/runtime-boundary.mjs', rootPackage.scripts?.['runtime:boundary'] || 'missing'));
  gates.push(gate('author metadata present', rootPackage.author === 'GravityblueX', rootPackage.author || 'missing'));
  gates.push(gate('license metadata present', rootPackage.license === 'MIT', rootPackage.license || 'missing'));
  gates.push(gate('security boundary documented', await fileIncludes('SECURITY.md', ['Supported Use', 'Out Of Scope', 'Maintenance Gates']), 'SECURITY.md'));
  gates.push(gate('README maintenance boundary documented', await fileIncludes('README.md', ['维护边界', 'npm run build', 'npm run test']), 'README.md'));

  const dirty = run('git', ['status', '--short']);
  const dirtyCount = dirty.output.split('\n').filter((line) => line.trim()).length;
  gates.push(gate('git status readable', dirty.exitCode === 0, `dirty_count=${dirtyCount}`));

  const commandResults = [];
  if (runChecks) {
    for (const [name, command, args] of [
      ['api surface command', 'npm', ['run', 'api:surface']],
      ['openapi command', 'npm', ['run', 'api:openapi']],
      ['dependency SBOM command', 'npm', ['run', 'deps:sbom']],
      ['runtime boundary command', 'npm', ['run', 'runtime:boundary']],
      ['build command', 'npm', ['run', 'build']],
      ['test command', 'npm', ['run', 'test']]
    ]) {
      const result = run(command, args);
      commandResults.push({ name, ...result });
      gates.push(gate(name, result.exitCode === 0, `${result.command} exit=${result.exitCode}`));
    }
  } else {
    gates.push(gate('build and test execution', true, 'not run; use --run-checks to execute commands'));
  }

  return {
    reportType: 'teamsync_release_readiness',
    generatedAt: new Date().toISOString(),
    project: rootPackage.name,
    version: rootPackage.version,
    ok: gates.every((item) => item.ok),
    runChecks,
    gates,
    commandResults,
    references: [
      'OpenSSF Scorecard style repository health gates',
      'OpenAPI Specification contract generated from the route inventory',
      'CycloneDX style dependency SBOM from package-lock files',
      'Renovate controlled dependency cadence',
      'Release readiness report before tagging',
      'Runtime boundary evidence between mounted API modules and candidate modules'
    ]
  };
}

function renderMarkdown(report) {
  const lines = [
    '# TeamSync Release Readiness',
    '',
    `Generated: ${report.generatedAt}`,
    `Project: \`${report.project}\``,
    `Version: \`${report.version}\``,
    `Status: \`${report.ok ? 'OK' : 'NOT READY'}\``,
    `Executed build/test: \`${report.runChecks}\``,
    '',
    '## Gates',
    '',
    '| Gate | Result | Detail |',
    '|---|---|---|'
  ];
  for (const item of report.gates) {
    lines.push(`| ${item.name} | ${item.ok ? 'OK' : 'FAIL'} | ${item.detail} |`);
  }
  if (report.commandResults.length > 0) {
    lines.push('', '## Command Results', '');
    for (const result of report.commandResults) {
      lines.push(`- ${result.name}: \`${result.command}\` exit \`${result.exitCode}\``);
    }
  }
  lines.push('', '## Reference Basis', '');
  for (const reference of report.references) {
    lines.push(`- ${reference}`);
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
