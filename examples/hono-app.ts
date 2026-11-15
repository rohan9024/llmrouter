import { Router } from '@rohan9024/llmrouter';

const llm = new Router({
  models: ['openai/gpt-5-mini', 'groq/openai/gpt-oss-120b'],
  strategy: 'lowest-latency'
});

export async function honoHandler(c: { req: { json: () => Promise<{ prompt: string }> }; json: (v: unknown) => unknown }) {
  const { prompt } = await c.req.json();
  const completion = await llm.chat.completions.create({
    messages: [{ role: 'user', content: prompt }]
  });
  return c.json(completion);
}