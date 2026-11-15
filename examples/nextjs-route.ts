import { Router } from '@rohan9024/llmrouter';

const llm = new Router({
  models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'],
  strategy: 'balanced'
});

export async function POST(req: Request) {
  const { prompt } = (await req.json()) as { prompt: string };
  const result = await llm.chat.completions.create({
    messages: [{ role: 'user', content: prompt }]
  });
  return Response.json({
    reply: result.choices[0].message.content,
    meta: result._routerMeta
  });
}