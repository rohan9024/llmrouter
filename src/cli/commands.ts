import fs from 'node:fs';
import path from 'node:path';
import { AdapterRegistry } from '../adapters/index.js';
import { BUILTIN_MODELS, CATALOG_VERSION } from '../catalog/models.js';
import { Router } from '../router.js';
import { BenchmarkRunner } from '../benchmark/runner.js';
import { RoutingStrategyName } from '../types.js';

export function runProviders(opts: { json?: boolean } = {}): number {
  const list = new AdapterRegistry().listBuiltins();
  if (opts.json) {
    console.log(JSON.stringify(list, null, 2));
    return 0;
  }
  console.log('\nLLMRouter Built-in Providers\n');
  for (const item of list) {
    console.log(`- ${item.id}: [${item.providers.join(', ')}]`);
  }
  return 0;
}

export function runModels(opts: {
  json?: boolean;
  vision?: boolean;
  tools?: boolean;
  jsonSchema?: boolean;
  provider?: string;
} = {}): number {
  let list = [...BUILTIN_MODELS];
  if (opts.provider) list = list.filter(m => m.provider === opts.provider!.toLowerCase());
  if (opts.vision) list = list.filter(m => m.capabilities.vision);
  if (opts.tools) list = list.filter(m => m.capabilities.tools);
  if (opts.jsonSchema) list = list.filter(m => m.capabilities.structuredOutput);

  if (opts.json) {
    console.log(JSON.stringify({ catalogVersion: CATALOG_VERSION, models: list }, null, 2));
    return 0;
  }
  console.log(`\nLLMRouter Model Catalog (v${CATALOG_VERSION})\n`);
  for (const m of list) {
    const caps = Object.entries(m.capabilities)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(',');
    const price = m.pricing ? `$${m.pricing.inputPerMillionTokens}/$${m.pricing.outputPerMillionTokens} per 1M` : 'N/A';
    console.log(`- ${m.id} | ctx=${m.contextWindow ?? 'N/A'} | ${price} | [${caps}]`);
  }
  return 0;
}

export function runExplainCli(opts: {
  models?: string;
  strategy?: RoutingStrategyName;
  vision?: boolean;
  tools?: boolean;
  jsonSchema?: boolean;
  maxCost?: number;
  prompt?: string;
  json?: boolean;
}): number {
  const modelList = opts.models
    ? opts.models.split(',').map(s => s.trim()).filter(Boolean)
    : ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5', 'groq/openai/gpt-oss-120b'];

  const router = new Router({ models: modelList, strategy: opts.strategy ?? 'priority' });
  const content: any = opts.vision
    ? [
        { type: 'text', text: opts.prompt ?? 'Describe image' },
        { type: 'image_url', image_url: { url: 'https://example.com/sample.png' } }
      ]
    : opts.prompt ?? 'Hello';

  const result = router.explain(
    {
      messages: [{ role: 'user', content }],
      ...(opts.tools
        ? { tools: [{ type: 'function', function: { name: 'sample_tool', parameters: { type: 'object' } } }] }
        : {}),
      ...(opts.jsonSchema
        ? { response_format: { type: 'json_schema', json_schema: { name: 'out', schema: { type: 'object' } } } }
        : {})
    },
    {
      budget: opts.maxCost !== undefined ? { maxEstimatedCostUsd: opts.maxCost } : undefined
    }
  );

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nSelected: ${result.selected ?? 'NONE'} (strategy: ${result.strategy})`);
    console.log('Reasons:', result.reason.join(' | '));
    if (result.rejected.length) {
      console.log('Rejected:');
      for (const r of result.rejected) console.log(`  - ${r.model}: ${r.reason}`);
    }
  }
  return result.selected ? 0 : 1;
}

export async function runBenchmarkCli(opts: {
  dataset?: string;
  models?: string;
  output?: string;
  recommendPolicy?: boolean;
  json?: boolean;
}): Promise<number> {
  if (!opts.dataset) {
    console.error('Error: --dataset <path.jsonl> is required for benchmark.');
    return 1;
  }

  const rawDataset = fs.readFileSync(path.resolve(opts.dataset), 'utf8').trim();
  const dataset = rawDataset.startsWith('[')
    ? JSON.parse(rawDataset)
    : rawDataset
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));

  let models: any[] = ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'];
  if (opts.models) {
    if (fs.existsSync(opts.models)) {
      models = JSON.parse(fs.readFileSync(opts.models, 'utf8'));
    } else {
      models = opts.models.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  const runner = new BenchmarkRunner();
  const report = await runner.run(dataset, models);

  if (opts.output) {
    fs.writeFileSync(path.resolve(opts.output), JSON.stringify(report, null, 2), 'utf8');
  }

  const out = opts.recommendPolicy ? report.recommendedPolicy : report;
  if (opts.json || opts.recommendPolicy) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`\nBenchmark complete (${report.datasetSize} case(s))`);
    for (const m of report.models) {
      console.log(
        `- ${m.model}: quality=${(m.qualityPassRate * 100).toFixed(0)}% infra=${(m.infraSuccessRate * 100).toFixed(0)}% avg=${m.averageLatencyMs}ms cost=$${m.totalReportedCostUsd}`
      );
    }
  }
  return 0;
}

export function runMigrate(opts: { cwd?: string; json?: boolean } = {}): number {
  const cwd = opts.cwd ?? process.cwd();
  const findings: Array<{ file: string; sdks: string[] }> = [];
  const skipDirs = new Set(['node_modules', 'dist', '.git', '.next']);

  const walk = (dir: string, depth: number) => {
    if (depth > 5 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        const full = path.join(dir, entry.name);
        const text = fs.readFileSync(full, 'utf8');
        const sdks: string[] = [];
        if (/new\s+OpenAI\s*\(/.test(text)) sdks.push('openai');
        if (/new\s+Anthropic\s*\(/.test(text)) sdks.push('@anthropic-ai/sdk');
        if (/GoogleGenAI/.test(text)) sdks.push('@google/genai');
        if (sdks.length) findings.push({ file: path.relative(cwd, full), sdks });
      }
    }
  };

  walk(cwd, 0);

  if (opts.json) {
    console.log(JSON.stringify({ findings, replacement: "new Router(['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'])" }, null, 2));
    return 0;
  }

  console.log('\nLLMRouter Migration Scan (read-only)\n');
  if (findings.length === 0) {
    console.log('No direct OpenAI/Anthropic/Gemini SDK instantiations detected.');
  } else {
    for (const f of findings) {
      console.log(`- ${f.file}: detected [${f.sdks.join(', ')}]`);
    }
    console.log("\nReplace client instantiation with `new Router([...])` from '@rohan9024/llmrouter'. Call `client.chat.completions.create(...)` unchanged.");
  }
  return 0;
}