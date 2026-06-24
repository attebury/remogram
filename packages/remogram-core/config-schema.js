import { z } from 'zod';
import { writeCommandSchema } from './write-config.js';

const providerSchema = z.enum([
  'gitea-api',
  'github-api',
  'gitlab-api',
  'gitea-tea',
  'github-gh',
]);

const repoSegmentSchema = z
  .string()
  .min(1)
  .refine((s) => !/[/%]/.test(s) && !s.includes('..') && !s.includes('/'), {
    message: 'owner/repo must not contain /, .., or %',
  });

const fieldMaxBytesSchema = z.union([
  z.number().int().positive(),
  z.null(),
  z.literal('none'),
]);

export const forgeWritePolicySchema = z
  .object({
    field_max_bytes: fieldMaxBytesSchema.optional(),
  })
  .strict();

export const configSchema = z
  .object({
    version: z.literal('1'),
    provider: providerSchema,
    remote: z.string().min(1).default('origin'),
    owner: repoSegmentSchema,
    repo: repoSegmentSchema,
    baseUrl: z.string().url().optional(),
    write_commands: z.array(writeCommandSchema).optional(),
    forge_write_policy: forgeWritePolicySchema.optional(),
    merge_policy: z
      .object({
        allow_missing_checks: z.boolean().optional(),
        allow_pending_checks: z.boolean().optional(),
      })
      .optional(),
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
