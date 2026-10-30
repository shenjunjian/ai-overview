# Naming and layout

- One concern per file; name files after the concern in kebab-case (`parse-args.ts`).
- Export a single `type` for each public options bag and suffix it with `Options`.
- Prefer `readonly` properties on option and result types.
- Use `const` by default, `let` only where a value is genuinely reassigned.
- No single-letter names outside of tight arithmetic loops.
- Put shared constants at the top of the module, above the first function.
- Tests live next to sources as `<name>.test.ts`.