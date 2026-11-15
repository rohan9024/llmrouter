import { Router } from '@rohan9024/llmrouter';

export const llm = new Router(['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5']);

export async function handleChat(req: { body: { message: string } }, res: { json: (v: unknown) => void }) {
  const completion = await llm.chat.completions.create({
    messages: [{ role: 'user', content: req.body.message }]
  });
  res.json(completion);
}