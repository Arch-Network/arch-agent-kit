import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ArchAgentKit } from '../agent';

/**
 * Vercel AI SDK tool set. The returned object is shaped for the `tools`
 * option of `generateText` / `streamText` — each entry has a Zod
 * `parameters` schema and an `execute` function. No hard dependency on
 * the `ai` package.
 */
export function createVercelAITools(agent: ArchAgentKit): Record<
  string,
  {
    description: string;
    parameters: unknown;
    execute: (input: unknown) => Promise<unknown>;
  }
> {
  const tools: Record<string, never> = {};
  for (const action of agent.actions) {
    (tools as Record<string, unknown>)[action.name] = {
      description: action.description,
      parameters: action.schema,
      execute: (input: unknown) => agent.run(action.name, input),
    };
  }
  return tools as never;
}

/**
 * OpenAI function-calling tool specs (JSON Schema). Pair with
 * `executeTool` to dispatch a tool call back into the agent.
 */
export function createOpenAITools(agent: ArchAgentKit): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}> {
  return agent.actions.map((action) => ({
    type: 'function',
    function: {
      name: action.name,
      description: action.description,
      parameters: zodToJsonSchema(action.schema, { target: 'openApi3' }),
    },
  }));
}

/** Dispatch a tool call (by name) into the agent with JSON-string args. */
export async function executeTool(
  agent: ArchAgentKit,
  name: string,
  args: string | Record<string, unknown>,
): Promise<unknown> {
  const input = typeof args === 'string' ? JSON.parse(args || '{}') : args;
  return agent.run(name, input);
}
