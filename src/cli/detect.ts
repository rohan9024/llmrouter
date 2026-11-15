import fs from 'node:fs';
import path from 'node:path';

export interface ProjectDetection {
  cwd: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  framework: 'nextjs' | 'express' | 'hono' | 'node';
  moduleSystem: 'esm' | 'cjs';
  typescript: boolean;
  existingSdks: string[];
  llmrouterInstalled: boolean;
  detectedEnvKeys: string[];
}

const KNOWN_PROVIDER_ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_HOST'];

export function detectEnvKeys(cwd: string): string[] {
  const found = new Set<string>();
  for (const k of KNOWN_PROVIDER_ENV_KEYS) {
    if (process.env[k]) found.add(k);
  }
  for (const envFile of ['.env', '.env.local']) {
    const full = path.join(cwd, envFile);
    if (!fs.existsSync(full)) continue;
    try {
      const content = fs.readFileSync(full, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
        if (match && KNOWN_PROVIDER_ENV_KEYS.includes(match[1]) && match[2].trim().length > 0) found.add(match[1]);
      }
    } catch {}
  }
  return Array.from(found);
}

export function detectProject(cwd: string = process.cwd()): ProjectDetection {
  let pkgJson: any = {};
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {}
  }

  const allDeps: Record<string, string> = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
  let packageManager: ProjectDetection['packageManager'] = 'npm';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) packageManager = 'bun';
  else if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) packageManager = 'yarn';

  let framework: ProjectDetection['framework'] = 'node';
  if (allDeps['next']) framework = 'nextjs';
  else if (allDeps['hono']) framework = 'hono';
  else if (allDeps['express']) framework = 'express';

  return {
    cwd,
    packageManager,
    framework,
    moduleSystem: pkgJson.type === 'module' ? 'esm' : 'cjs',
    typescript: fs.existsSync(path.join(cwd, 'tsconfig.json')) || Boolean(allDeps['typescript']),
    existingSdks: ['openai', '@anthropic-ai/sdk', '@google/genai', 'ai'].filter(sdk => Boolean(allDeps[sdk])),
    llmrouterInstalled: Boolean(allDeps['@rohan9024/llmrouter']),
    detectedEnvKeys: detectEnvKeys(cwd)
  };
}
