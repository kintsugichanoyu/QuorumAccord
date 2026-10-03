import { defineConfig } from '@playwright/test';
import config from './playwright.config.ts';

export default defineConfig({ ...config, testDir: './tests/live', timeout: 60_000 });
