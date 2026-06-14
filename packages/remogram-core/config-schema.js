import { z } from 'zod';

const providerSchema = z.enum([
  'gitea-api',
  'github-api',
  'gitlab-api',
  'gitea-tea',
  'github-gh',
]);

const writeCommandSchema = z.enum(['cr_open']);

const repoSegmentSchema = z
  .string()
  .min(1)
  .refine((s) => !/[/%]/.test(s) && !s.includes('..') && !s.includes('/'), {
    message: 'owner/repo must not contain /, .., or %',
  });

export const configSchema = z
  .object({
    version: z.literal('1'),
    provider: providerSchema,
    remote: z.string().min(1).default('origin'),
    owner: repoSegmentSchema,
    repo: repoSegmentSchema,
    baseUrl: z.string().url().optional(),
    write_commands: z.array(writeCommandSchema).optional(),
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
