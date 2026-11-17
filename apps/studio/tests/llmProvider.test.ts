import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { PathLike } from 'node:fs';
import path from 'node:path';

const modelEnvKeys = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;
const previousEnv = Object.fromEntries(modelEnvKeys.map((key) => [key, process.env[key]]));
for (const key of modelEnvKeys) {
    delete process.env[key];
}

const mainRoot = path.resolve(import.meta.dir, '../electron/main');
mock.module(path.join(mainRoot, 'storage/index.ts'), () => ({
    PersistentStorage: {
        USER_SETTINGS: { read: () => ({}) },
        LOCAL_AI_CREDENTIALS: { read: () => null },
    },
}));

const actualFs = await import('node:fs');
mock.module('node:fs', () => ({
    ...actualFs,
    existsSync: (filePath: PathLike) =>
        String(filePath).endsWith(path.join('.claude', 'settings.json'))
            ? false
            : actualFs.existsSync(filePath),
}));

const { initModel, testLocalGateway } = await import('../electron/main/chat/llmProvider');
const { CLAUDE_MODELS, LLMProvider } = await import('@onlook/models/llm');
const { StreamRequestType } = await import('@onlook/models/chat');

afterAll(() => {
    for (const key of modelEnvKeys) {
        const value = previousEnv[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe('optional built-in AI', () => {
    it('does not fall back to a model when none is configured', async () => {
        await expect(
            initModel(LLMProvider.ANTHROPIC, CLAUDE_MODELS.SONNET_4, {
                requestType: StreamRequestType.CHAT,
            }),
        ).rejects.toThrow('Built-in AI is not configured');
    });

    it('explains that preview works without a configured model', async () => {
        const result = await testLocalGateway();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Project preview');
        expect(result.message).toContain('still work');
    });
});
