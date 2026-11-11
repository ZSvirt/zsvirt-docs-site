import { createHash } from 'node:crypto';
import { z } from 'zod';

const SCHEMA_VERSION = 1;
const requiredText = (max = 100_000) => z.string().min(1).max(max).refine((value) => Boolean(value.trim()), 'must not be blank');
const headingSchema = z.strictObject({ id: requiredText(500), content: requiredText() });
const contentSchema = z.strictObject({ heading: requiredText(500).optional(), content: requiredText() });
const recordSchema = z.strictObject({
  id: requiredText(500).regex(/^[A-Za-z0-9:_./-]+$/, 'contains unsupported characters'),
  locale: z.enum(['zh', 'en']),
  url: requiredText(2_000),
  title: requiredText(),
  description: requiredText().optional(),
  breadcrumbs: z.array(requiredText()).optional(),
  tag: requiredText(200).optional(),
  structuredData: z.strictObject({ headings: z.array(headingSchema), contents: z.array(contentSchema) }),
}).superRefine((record, context) => {
  const prefix = record.locale === 'zh' ? '/docs' : '/en/docs';
  if ((record.url !== prefix && !record.url.startsWith(`${prefix}/`)) ||
      record.url.includes('?') || record.url.includes('#') || record.url.includes('\\') ||
      record.url.includes('//') || /%(?:2f|5c)/i.test(record.url)) {
    context.addIssue({ code: 'custom', path: ['url'], message: `must be a local ${record.locale} docs path` });
  } else {
    try {
      if (new URL(record.url, 'https://docs.invalid').pathname !== record.url) {
        context.addIssue({ code: 'custom', path: ['url'], message: 'must be a canonical local path' });
      }
    } catch {
      context.addIssue({ code: 'custom', path: ['url'], message: 'must be a valid local path' });
    }
  }
  const headingIds = new Set();
  for (const [index, heading] of record.structuredData.headings.entries()) {
    if (/[#?\s\\]/u.test(heading.id) || headingIds.has(heading.id)) {
      context.addIssue({ code: 'custom', path: ['structuredData', 'headings', index, 'id'], message: 'invalid or duplicate heading ID' });
    }
    headingIds.add(heading.id);
  }
  for (const [index, content] of record.structuredData.contents.entries()) {
    if (content.heading !== undefined && !headingIds.has(content.heading)) {
      context.addIssue({ code: 'custom', path: ['structuredData', 'contents', index, 'heading'], message: 'references an unknown heading' });
    }
  }
});
const recordsSchema = z.array(recordSchema).superRefine((records, context) => {
  const counts = { zh: 0, en: 0 };
  const ids = new Set();
  const urls = new Set();
  for (const [index, record] of records.entries()) {
    counts[record.locale] += 1;
    if (ids.has(record.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'record IDs must be globally unique' });
    if (urls.has(record.url)) context.addIssue({ code: 'custom', path: [index, 'url'], message: 'record URLs must be unique' });
    ids.add(record.id);
    urls.add(record.url);
  }
  if (!counts.zh || !counts.en) context.addIssue({ code: 'custom', message: 'both zh and en records are required' });
  const generatedIds = new Set(ids);
  for (const [index, record] of records.entries()) {
    const childCount = Number(Boolean(record.description)) + record.structuredData.headings.length + record.structuredData.contents.length;
    for (let i = 0; i < childCount; i += 1) {
      const childId = `${record.id}-${i}`;
      if (generatedIds.has(childId)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'generated search document IDs collide' });
      generatedIds.add(childId);
    }
  }
});
const snapshotSchema = z.strictObject({ schemaVersion: z.literal(SCHEMA_VERSION), version: z.string().regex(/^[a-f0-9]{64}$/), records: z.array(z.unknown()) });

function valid(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(`Invalid search snapshot: ${issue.path.join('.') || 'root'} ${issue.message}`);
}

function canonicalRecords(input) {
  const records = valid(recordsSchema, input);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return records.sort((a, b) => compare(a.locale, b.locale) || compare(a.id, b.id));
}

function versionFor(records) {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function createSnapshot(records) {
  const normalized = canonicalRecords(records);
  return { schemaVersion: SCHEMA_VERSION, version: versionFor(normalized), records: normalized };
}

export function parseSnapshot(input) {
  let raw;
  try {
    raw = typeof input === 'string' || Buffer.isBuffer(input) ? JSON.parse(input.toString()) : input;
  } catch {
    throw new Error('Invalid search snapshot: JSON is malformed');
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Invalid search snapshot: unsupported schema version');
  }
  const snapshot = valid(snapshotSchema, raw);
  const records = canonicalRecords(snapshot.records);
  const actualVersion = versionFor(records);
  if (snapshot.version !== actualVersion) throw new Error('Invalid search snapshot: version checksum mismatch');
  return { schemaVersion: SCHEMA_VERSION, version: actualVersion, records };
}
