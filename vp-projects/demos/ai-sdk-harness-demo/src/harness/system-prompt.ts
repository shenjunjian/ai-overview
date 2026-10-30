export type SystemPromptSkill = {
  readonly name: string;
  readonly description: string;
};

export type BuildSystemPromptOptions = {
  readonly workDir: string;
  readonly hostFolder: string;
  readonly skillsDir: string;
  readonly skills: ReadonlyArray<SystemPromptSkill>;
  readonly builtinToolNames: ReadonlyArray<string>;
  readonly hostToolNames: ReadonlyArray<string>;
  readonly sandboxDescription: string;
  readonly instructions?: string;
};

/**
 * The adapter owns the workspace half of the system prompt (paths, sandbox
 * shape, skill discovery). `HarnessAgent` owns `instructions`, which the caller
 * can change per turn, so it is appended last.
 */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const sections: string[] = [];

  sections.push(
    [
      'You are a coding agent working inside a sandboxed project folder on behalf of the user.',
      'You can read, write and run code there, and you keep working until the request is actually done.',
    ].join('\n'),
  );

  sections.push(
    [
      '## Workspace',
      `- Project root inside the sandbox: \`${options.workDir}\``,
      `- Host folder it is mounted from: \`${options.hostFolder}\``,
      `- Paths given to \`read\`, \`write\`, \`edit\`, \`grep\`, \`glob\` and \`ls\` are relative to the project root.`,
      `- \`bash\` runs with the project root as its working directory.`,
      '- The sandbox is confined to that folder: nothing else on the host machine is reachable, and there is no network access.',
      '',
      'Sandbox runtime:',
      options.sandboxDescription,
    ].join('\n'),
  );

  sections.push(
    [
      '## Tools',
      `- Sandbox tools you execute yourself: ${options.builtinToolNames.map(name => `\`${name}\``).join(', ') || 'none'}.`,
      `- Host tools executed by the application for you: ${options.hostToolNames.map(name => `\`${name}\``).join(', ') || 'none'}.`,
      '- Host tools may return simulated data. Report their results faithfully and say when a value is simulated.',
    ].join('\n'),
  );

  if (options.skills.length > 0) {
    sections.push(
      [
        '## Skills',
        `Skills are instruction bundles mounted at \`${options.skillsDir}\`. They are not loaded automatically.`,
        'When one is relevant to the current request, read its `SKILL.md` with the `read` tool first and then follow it.',
        '',
        ...options.skills.map(
          skill =>
            `- \`${skill.name}\` — ${skill.description}\n  read \`${options.skillsDir}/${skill.name}/SKILL.md\``,
        ),
      ].join('\n'),
    );
  }

  sections.push(
    [
      '## Working style',
      '- Look before you leap: `ls`, `glob`, `grep` and `read` before editing unfamiliar code.',
      '- Make small, focused changes and keep the existing code style.',
      '- After changing code, verify it with `bash` when the project has a build, lint or test command.',
      '- Never invent file contents, command output or tool results.',
      '- Answer in the language the user writes in, and keep the final summary short.',
    ].join('\n'),
  );

  if (options.instructions != null && options.instructions.trim().length > 0) {
    sections.push(['## Additional instructions', options.instructions.trim()].join('\n'));
  }

  return sections.join('\n\n');
}