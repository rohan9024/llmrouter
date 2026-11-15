import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BenchmarkRunner } from '../src/benchmark/runner.js';
import { runInit } from '../src/cli/init.js';
import { runDoctor } from '../src/cli/doctor.js';

describe('BenchmarkRunner & CLI Diagnostics', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('evaluates dataset validators and generates a recommended policy', async () => {
    global.fetch = vi.fn().mockImplementation(async url => {
      const isGroq = String(url).includes('groq');
      return new Response(
        JSON.stringify({
          id: 'b1',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: isGroq ? '{"ok":true}' : 'not json' },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
        }),
        { status: 200 }
      );
    });

    const runner = new BenchmarkRunner();
    const report = await runner.run(
      [
        {
          id: 'case-1',
          messages: [{ role: 'user', content: 'Return JSON' }],
          validators: [{ type: 'json-valid' }]
        }
      ],
      ['openai/gpt-5-mini', 'groq/openai/gpt-oss-120b']
    );

    expect(report.recommendedPolicy.models[0].id).toBe('groq/openai/gpt-oss-120b');
    expect(report.models.find(m => m.model === 'groq/openai/gpt-oss-120b')?.qualityPassRate).toBe(1);
  });

  it('scaffolds project cleanly via init --dry-run and runs doctor', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmrouter-cli-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'demo', type: 'module', dependencies: { next: '15.0.0', '@rohan9024/llmrouter': '2.0.0' } })
    );
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{}');

    const { exitCode, result } = await runInit({ cwd: tmp, dryRun: true, yes: true, json: true });
    expect(exitCode).toBe(0);
    expect(result.framework).toBe('nextjs');
    expect(result.createdFiles).toContain('lib/llm.ts');

    const doc = runDoctor({ cwd: tmp, json: true });
    expect(doc.exitCode).toBe(0);
    expect(doc.report.ok).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});