import { tool } from 'ai';
import { z } from 'zod';

const SIMULATED_LATENCY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Stable pseudo-random number in [0, 1) derived from a string. */
function seededUnit(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 1_677_761_9);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

const KNOWLEDGE_BASE: ReadonlyArray<{
  readonly title: string;
  readonly tags: ReadonlyArray<string>;
  readonly body: string;
}> = [
  {
    title: 'Release checklist',
    tags: ['release', 'publish', 'version'],
    body: 'Bump the version, run the test suite, tag the commit, then publish. Never publish from a dirty working tree.',
  },
  {
    title: 'Error handling policy',
    tags: ['error', 'errors', 'handling'],
    body: 'Throw typed errors at boundaries, return results inside modules, and never swallow an exception without logging it.',
  },
  {
    title: 'Commit message style',
    tags: ['commit', 'git', 'message'],
    body: 'Use conventional commits: feat, fix, docs, refactor, test, chore. Keep the subject under 72 characters.',
  },
];

let issueSequence = 1_000;

/**
 * Host-executed tools. They run in this Node process, not in the sandbox, and
 * every one of them returns fabricated data so the demo needs no external
 * services. `HarnessAgent` executes them and feeds the values back to the
 * adapter through `submitToolResult`.
 */
export const mockTools = {
  getCurrentTime: tool({
    description:
      'Get the current date and time on the host machine. The sandbox clock is isolated, so use this tool when real wall-clock time matters.',
    inputSchema: z.object({
      timeZone: z
        .string()
        .optional()
        .describe('IANA time zone name, for example "Asia/Shanghai".'),
    }),
    execute: async ({ timeZone }) => {
      await sleep(SIMULATED_LATENCY_MS);
      const now = new Date();
      return {
        simulated: false,
        iso: now.toISOString(),
        local: now.toLocaleString('en-GB', {
          timeZone: timeZone ?? undefined,
          hour12: false,
        }),
        timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  }),

  getWeather: tool({
    description:
      'Get a simulated weather report for a city. Values are fabricated deterministically from the city name.',
    inputSchema: z.object({
      city: z.string().describe('City name, for example "Hangzhou".'),
      unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit.'),
    }),
    execute: async ({ city, unit }) => {
      await sleep(SIMULATED_LATENCY_MS);
      const seed = seededUnit(city.toLowerCase());
      const celsius = Math.round(-5 + seed * 40);
      const temperature = unit === 'fahrenheit' ? Math.round(celsius * 1.8 + 32) : celsius;
      const conditions = ['sunny', 'cloudy', 'rainy', 'windy', 'foggy'][
        Math.floor(seed * 5) % 5
      ] as string;
      return {
        simulated: true,
        city,
        temperature,
        unit: unit ?? 'celsius',
        conditions,
        humidityPercent: Math.round(30 + seed * 60),
      };
    },
  }),

  searchKnowledgeBase: tool({
    description:
      'Search the simulated internal knowledge base and return matching policy snippets.',
    inputSchema: z.object({
      query: z.string().describe('Free-text search query.'),
      limit: z.number().int().positive().max(10).optional().describe('Maximum results.'),
    }),
    execute: async ({ query, limit }) => {
      await sleep(SIMULATED_LATENCY_MS);
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const matches = KNOWLEDGE_BASE.map(entry => ({
        entry,
        score:
          terms.filter(
            term =>
              entry.title.toLowerCase().includes(term) ||
              entry.tags.some(tag => tag.includes(term)),
          ).length,
      }))
        .filter(match => match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit ?? 3);
      return {
        simulated: true,
        query,
        results: matches.map(({ entry, score }) => ({
          title: entry.title,
          body: entry.body,
          score,
        })),
      };
    },
  }),

  createIssue: tool({
    description: 'Create a ticket in the simulated issue tracker and return its id and URL.',
    inputSchema: z.object({
      title: z.string().describe('Short issue title.'),
      body: z.string().optional().describe('Issue description.'),
      labels: z.array(z.string()).optional().describe('Labels to attach.'),
    }),
    execute: async ({ title, body, labels }) => {
      await sleep(SIMULATED_LATENCY_MS);
      issueSequence += 1;
      return {
        simulated: true,
        id: `DEMO-${issueSequence}`,
        title,
        body: body ?? '',
        labels: labels ?? [],
        url: `https://tracker.example.com/issues/DEMO-${issueSequence}`,
        state: 'open',
      };
    },
  }),

  deployPreview: tool({
    description:
      'Pretend to deploy the current project folder to a preview environment and return the preview URL.',
    inputSchema: z.object({
      environment: z.enum(['preview', 'staging']).describe('Target environment.'),
      commit: z.string().optional().describe('Commit-ish label to deploy.'),
    }),
    execute: async ({ environment, commit }) => {
      await sleep(SIMULATED_LATENCY_MS * 2);
      const buildId = Math.floor(seededUnit(`${environment}${commit ?? ''}${issueSequence}`) * 9000 + 1000);
      return {
        simulated: true,
        environment,
        commit: commit ?? 'HEAD',
        buildId,
        url: `https://${environment}-${buildId}.demo.example.com`,
        status: 'ready',
      };
    },
  }),
};

export type MockTools = typeof mockTools;

export const MOCK_TOOL_NAMES = Object.keys(mockTools);