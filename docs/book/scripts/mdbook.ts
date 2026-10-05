import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Keep task-owned installations from before the rename working.
const installs = ['quorum-toolchains', 'reflect-toolchains']
  .map(name => join(homedir(), '.local/share', name, 'mdbook-v0.5.4/mdbook'));
export const mdbook = process.env.MDBOOK_BIN ?? installs.find(existsSync) ?? 'mdbook';
