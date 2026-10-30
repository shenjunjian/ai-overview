import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { HarnessV1Skill } from '@ai-sdk/harness';

const SKILL_FILE_NAME = 'SKILL.md';
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ts',
  '.mts',
  '.js',
  '.mjs',
  '.sh',
  '.py',
  '.css',
  '.html',
]);

type FrontMatter = {
  readonly fields: Record<string, string>;
  readonly body: string;
};

function parseFrontMatter(content: string): FrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (match == null) return { fields: {}, body: content };

  const fields: Record<string, string> = {};
  for (const line of (match[1] as string).split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (key.length > 0) fields[key] = value;
  }
  return { fields, body: content.slice(match[0].length) };
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

async function collectSkillFiles(
  skillDir: string,
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  const entries = await readdir(skillDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = toPosix(path.relative(skillDir, absolute));
    if (relative === SKILL_FILE_NAME) continue;
    if (!TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) continue;
    files.push({ path: relative, content: await readFile(absolute, 'utf8') });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Reads `skills/<name>/SKILL.md` bundles from disk into `HarnessV1Skill`s.
 * `HarnessAgent` forwards them to the adapter every turn, which materializes
 * them inside the sandbox so the model can `read` a skill on demand.
 */
export async function loadSkillsFromDirectory(
  directory: string,
): Promise<HarnessV1Skill[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: HarnessV1Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(entry.parentPath, entry.name);
    const skillFile = path.join(skillDir, SKILL_FILE_NAME);
    try {
      const info = await stat(skillFile);
      if (!info.isFile()) continue;
    } catch {
      continue;
    }

    const { fields, body } = parseFrontMatter(await readFile(skillFile, 'utf8'));
    const name = fields['name'] ?? entry.name;
    const description = fields['description'] ?? '';
    const files = await collectSkillFiles(skillDir);
    skills.push({
      name,
      description,
      content: body.trim(),
      ...(files.length > 0 ? { files } : {}),
    });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}