import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each invocation gets isolated demo data and never touches the development DB.
const directory = mkdtempSync(join(tmpdir(), 'squarebox-ui-'));
process.env.DATABASE_PATH = join(directory, 'test.sqlite');
process.env.PORT = '3105';
process.env.NODE_ENV = 'production';
process.env.HOST = '127.0.0.1';
process.env.STAFF_PIN = '2468';
process.env.COOKIE_SECURE = 'false';
delete process.env.PUBLIC_BASE_URL;
delete process.env.SQUAREBOX_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
await import('../server/index.ts');
