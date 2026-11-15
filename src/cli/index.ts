import { runInit } from './init.js';
import { runDoctor } from './doctor.js';
import {
  runBenchmarkCli,
  runExplainCli,
  runMigrate,
  runModels,
  runProviders
} from './commands.js';
import { RoutingStrategyName } from '../types.js';

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | boolean> } {
  const [cmd = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '-y') {
      flags.yes = true;
      continue;
    }
    if (arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = rest[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    }
  }
  return { cmd, flags };
}

function printHelp(): void {
  console.log(`@rohan9024/llmrouter CLI

Commands:
  init       Detect project framework and scaffold Router integration (--yes, --dry-run, --force, --json)
  doctor     Verify Node runtime, adapters, env keys, and policies (--json)
  providers  List supported provider adapters and capabilities (--json)
  models     List built-in capability-aware model catalog (--vision, --tools, --json-schema, --provider, --json)
  explain    Simulate and explain model selection (--models, --strategy, --vision, --tools, --max-cost, --json)
  benchmark  Evaluate dataset across models (--dataset, --models, --output, --recommend-policy, --json)
  migrate    Scan codebase for direct provider SDK calls (read-only, --json)
`);
}

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const json = Boolean(flags.json);

  if (cmd === 'help' || flags.help) {
    printHelp();
    process.exit(0);
  }

  switch (cmd) {
    case 'init': {
      const { exitCode } = await runInit({
        yes: Boolean(flags.yes),
        dryRun: Boolean(flags['dry-run']),
        force: Boolean(flags.force),
        json
      });
      process.exit(exitCode);
    }
    case 'doctor': {
      const { exitCode } = runDoctor({ json });
      process.exit(exitCode);
    }
    case 'providers':
      process.exit(runProviders({ json }));
    case 'models':
      process.exit(
        runModels({
          json,
          vision: Boolean(flags.vision),
          tools: Boolean(flags.tools),
          jsonSchema: Boolean(flags['json-schema']),
          provider: typeof flags.provider === 'string' ? flags.provider : undefined
        })
      );
    case 'explain':
      process.exit(
        runExplainCli({
          json,
          models: typeof flags.models === 'string' ? flags.models : undefined,
          strategy: typeof flags.strategy === 'string' ? (flags.strategy as RoutingStrategyName) : undefined,
          vision: Boolean(flags.vision),
          tools: Boolean(flags.tools),
          jsonSchema: Boolean(flags['json-schema']),
          maxCost: typeof flags['max-cost'] === 'string' ? Number(flags['max-cost']) : undefined,
          prompt: typeof flags.prompt === 'string' ? flags.prompt : undefined
        })
      );
    case 'benchmark':
      process.exit(
        await runBenchmarkCli({
          json,
          dataset: typeof flags.dataset === 'string' ? flags.dataset : undefined,
          models: typeof flags.models === 'string' ? flags.models : undefined,
          output: typeof flags.output === 'string' ? flags.output : undefined,
          recommendPolicy: Boolean(flags['recommend-policy'])
        })
      );
    case 'migrate':
      process.exit(runMigrate({ json }));
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});