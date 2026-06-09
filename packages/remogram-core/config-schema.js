import { z } from 'zod';

const providerSchema = z.enum([
  'gitea-api',
  'github-api',
  'gitea-tea',
  'github-gh',
]);

export const configSchema = z
  .object({
    version: z.literal('1'),
    provider: providerSchema,
    remote: z.string().min(1).default('origin'),
    owner: z.string().min(1),
    repo: z.string().min(1),
    baseUrl: z.string().url().optional(),
    trustedHosts: z.array(z.string().min(1)).optional(),
  })
  .strict();

export function parseConfigFile(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON in .remogram.json');
  }
  return configSchema.parse(parsed);
}
