import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { detectProject } from './detect.js';

export interface InitOptions {
  cwd?: string;
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
}

export interface InitResult {
  framework: string;
  packageManager: string;
  moduleSystem: string;
  installCommand: string;
  llmrouterInstalled: boolean;
  createdFiles: string[];
  skippedFiles: string[];
  detectedEnvKeys: string[];
}

export async function runInit(opts: InitOptions = {}): Promise<{ exitCode: number; result: InitResult }> {
  const cwd = opts.cwd ?? process.cwd();
  const info = detectProject(cwd);
  const ext = info.typescript ? 'ts' : 'js';
  const routerFileRel = fs.existsSync(path.join(cwd, 'src')) ? `src/lib/llm.${ext}` : `lib/llm.${ext}`;
  const routerFileAbs = path.join(cwd, routerFileRel);
  const envExampleAbs = path.join(cwd, '.env.example');

  const modelList = ["'openai/gpt-5-mini'", "'anthropic/claude-sonnet-5-5'", "'groq/openai/gpt-oss-120b'"];

  const fileContent = info.typescript
    ? `import { Router } from '@rohan9024/llmrouter';

export const llm = new Router({
  models: [${modelList.join(', ')}],
  strategy: 'balanced',
  retry: {
    maxRetriesPerTarget: 1,
    maxTotalAttempts: 4
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    openDurationMs: 30_000
  }
});
`
    : `${info.moduleSystem === 'esm' ? "import { Router } from '@rohan9024/llmrouter';" : "const { Router } = require('@rohan9024/llmrouter');"}

${info.moduleSystem === 'esm' ? 'export const llm =' : 'const llm ='} new Router({
  models: [${modelList.join(', ')}],
  strategy: 'balanced'
});
${info.moduleSystem === 'cjs' ? '\nmodule.exports = { llm };\n' : ''}`;

  const envTemplate = `# Server-side API keys for @rohan9024/llmrouter (never expose in frontend bundles)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
`;

  const installCommand =
    info.packageManager === 'pnpm'
      ? 'pnpm add @rohan9024/llmrouter'
      : info.packageManager === 'yarn'
        ? 'yarn add @rohan9024/llmrouter'
        : info.packageManager === 'bun'
          ? 'bun add @rohan9024/llmrouter'
          : 'npm install @rohan9024/llmrouter';

  if (!opts.yes && !opts.dryRun && !opts.json && process.stdin.isTTY) {
    console.log('\nLLMRouter project detection');
    console.log(`Framework: ${info.framework} | Package manager: ${info.packageManager} | ${info.moduleSystem.toUpperCase()}`);
    console.log(`Detected env keys: ${info.detectedEnvKeys.length ? info.detectedEnvKeys.join(', ') : 'none'}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nScaffold ${routerFileRel} and .env.example? (y/N) `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      return {
        exitCode: 0,
        result: {
          framework: info.framework,
          packageManager: info.packageManager,
          moduleSystem: info.moduleSystem,
          installCommand,
          llmrouterInstalled: info.llmrouterInstalled,
          createdFiles: [],
          skippedFiles: [routerFileRel],
          detectedEnvKeys: info.detectedEnvKeys
        }
      };
    }
  }

  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  if (!fs.existsSync(routerFileAbs) || opts.force) {
    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(routerFileAbs), { recursive: true });
      fs.writeFileSync(routerFileAbs, fileContent, 'utf8');
    }
    createdFiles.push(routerFileRel);
  } else {
    skippedFiles.push(routerFileRel);
  }

  if (!fs.existsSync(envExampleAbs)) {
    if (!opts.dryRun) {
      fs.writeFileSync(envExampleAbs, envTemplate, 'utf8');
    }
    createdFiles.push('.env.example');
  } else {
    skippedFiles.push('.env.example');
  }

  const result: InitResult = {
    framework: info.framework,
    packageManager: info.packageManager,
    moduleSystem: info.moduleSystem,
    installCommand,
    llmrouterInstalled: info.llmrouterInstalled,
    createdFiles,
    skippedFiles,
    detectedEnvKeys: info.detectedEnvKeys
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nLLMRouter init ${opts.dryRun ? '(dry-run)' : 'complete'}`);
    console.log(`- Framework: ${info.framework} (${info.moduleSystem.toUpperCase()})`);
    if (!info.llmrouterInstalled) console.log(`- Next install: ${installCommand}`);
    console.log(`- Created: ${createdFiles.length ? createdFiles.join(', ') : 'none'}`);
    if (skippedFiles.length) console.log(`- Skipped existing: ${skippedFiles.join(', ')}`);
    console.log(`- Verify next: npx @rohan9024/llmrouter doctor`);
  }

  return { exitCode: 0, result };
}