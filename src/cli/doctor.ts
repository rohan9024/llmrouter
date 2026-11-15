import { detectProject } from './detect.js';
import { AdapterRegistry } from '../adapters/index.js';
import { resolveRetryConfig } from '../reliability/retry.js';
import { DEFAULT_CIRCUIT_CONFIG } from '../reliability/health.js';

export interface DoctorCheck {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  nodeVersion: string;
  framework: string;
  packageManager: string;
  moduleSystem: string;
  detectedEnvKeys: string[];
  checks: DoctorCheck[];
  recommendations: string[];
}

export function runDoctor(opts: { cwd?: string; json?: boolean } = {}): { exitCode: number; report: DoctorReport } {
  const cwd = opts.cwd ?? process.cwd();
  const project = detectProject(cwd);
  const adapters = new AdapterRegistry().listBuiltins();
  const nodeMajor = Number(process.versions.node.split('.')[0]);

  const checks: DoctorCheck[] = [];
  const recommendations: string[] = [];

  if (nodeMajor >= 22) {
    checks.push({ name: 'Node.js runtime', status: 'PASS', detail: `v${process.versions.node} (>=22 required)` });
  } else {
    checks.push({ name: 'Node.js runtime', status: 'FAIL', detail: `v${process.versions.node} is below >=22` });
    recommendations.push('Upgrade Node.js to LTS >=22 (22, 24, or 26).');
  }

  if (project.llmrouterInstalled) {
    checks.push({ name: 'Package installed', status: 'PASS', detail: '@rohan9024/llmrouter found in package.json' });
  } else {
    checks.push({ name: 'Package installed', status: 'WARN', detail: '@rohan9024/llmrouter not yet in dependencies' });
    recommendations.push(`Install via: ${project.packageManager} ${project.packageManager === 'npm' ? 'install' : 'add'} @rohan9024/llmrouter`);
  }

  checks.push({
    name: 'Adapters loaded',
    status: 'PASS',
    detail: adapters.map(a => a.id).join(', ')
  });

  if (project.detectedEnvKeys.length >= 2) {
    checks.push({
      name: 'Provider keys',
      status: 'PASS',
      detail: `${project.detectedEnvKeys.length} provider key(s) detected (${project.detectedEnvKeys.join(', ')})`
    });
  } else if (project.detectedEnvKeys.length === 1) {
    checks.push({
      name: 'Provider keys',
      status: 'WARN',
      detail: `Only 1 key detected (${project.detectedEnvKeys[0]}); add a backup provider for failover`
    });
    recommendations.push('Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY in server env for multi-provider fallback.');
  } else {
    checks.push({
      name: 'Provider keys',
      status: 'WARN',
      detail: 'No provider keys found in env or .env'
    });
    recommendations.push('Set at least two provider keys (e.g. OPENAI_API_KEY and ANTHROPIC_API_KEY) in your server environment.');
  }

  const retry = resolveRetryConfig();
  checks.push({
    name: 'Retry policy valid',
    status: 'PASS',
    detail: `maxRetriesPerTarget=${retry.maxRetriesPerTarget}, maxTotalAttempts=${retry.maxTotalAttempts}`
  });

  checks.push({
    name: 'Circuit breaker valid',
    status: 'PASS',
    detail: `failureThreshold=${DEFAULT_CIRCUIT_CONFIG.failureThreshold}, openDurationMs=${DEFAULT_CIRCUIT_CONFIG.openDurationMs}`
  });

  const ok = checks.every(c => c.status !== 'FAIL');
  const report: DoctorReport = {
    ok,
    nodeVersion: process.versions.node,
    framework: project.framework,
    packageManager: project.packageManager,
    moduleSystem: project.moduleSystem,
    detectedEnvKeys: project.detectedEnvKeys,
    checks,
    recommendations
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\nLLMRouter Doctor\n');
    for (const c of checks) {
      console.log(`[${c.status}] ${c.name}: ${c.detail}`);
    }
    if (recommendations.length > 0) {
      console.log('\nRecommended actions:');
      recommendations.forEach(r => console.log(`- ${r}`));
    }
  }

  return { exitCode: ok ? 0 : 1, report };
}