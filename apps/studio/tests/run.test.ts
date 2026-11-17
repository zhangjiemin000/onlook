import { describe, expect, it, mock } from 'bun:test';
import path from 'node:path';

const mainRoot = path.resolve(import.meta.dir, '../electron/main');
const executeCommand = mock(() => {});
const sendMainWindowMessage = mock(() => {});

mock.module(path.join(mainRoot, 'index.ts'), () => ({
    mainWindow: { webContents: { send: sendMainWindowMessage } },
}));
mock.module(path.join(mainRoot, 'analytics/index.ts'), () => ({
    default: { updateUserMetadata: () => {} },
    sendAnalytics: () => {},
}));
mock.module(path.join(mainRoot, 'code/files.ts'), () => ({ writeFile: async () => {} }));
mock.module(path.join(mainRoot, 'run/cleanup.ts'), () => ({
    removeIdsFromDirectory: async () => {},
}));
const actualRunHelpers = await import('../electron/main/run/helpers');
const actualGetValidFiles = actualRunHelpers.getValidFiles;
mock.module(path.join(mainRoot, 'run/helpers.ts'), () => ({
    ...actualRunHelpers,
    getValidFiles: async (dirPath: string) =>
        dirPath === '/tmp/onlook-test' ? [] : actualGetValidFiles(dirPath),
}));
mock.module(path.join(mainRoot, 'run/setup.ts'), () => ({
    createMappingFromContent: () => ({}),
    getFileWithIds: async () => '',
}));
mock.module(path.join(mainRoot, 'bun/index.ts'), () => ({
    getBunCommand: (command: string) => command,
}));
const { default: actualTerminal } = await import('../electron/main/run/terminal');
mock.module(path.join(mainRoot, 'run/terminal.ts'), () => ({
    default: {
        create: () => {},
        executeCommand,
        kill: () => {},
    },
}));
mock.module('@parcel/watcher', () => ({
    subscribe: async () => ({ unsubscribe: async () => {} }),
}));

const { default: runManager } = await import('../electron/main/run/index');
const { MainChannels } = await import('@onlook/models/constants');
const { RunState } = await import('@onlook/models/run');

describe('project run without AI', () => {
    it('starts the project command with an invalid model gateway', async () => {
        const previousUrl = process.env.ANTHROPIC_BASE_URL;
        const previousModel = process.env.ANTHROPIC_MODEL;
        process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1';
        process.env.ANTHROPIC_MODEL = 'unavailable-model';

        try {
            const started = await runManager.start(
                'test-project',
                '/tmp/onlook-test',
                'npm run dev',
            );

            expect(started).toBe(true);
            expect(runManager.state).toBe(RunState.RUNNING);
            expect(executeCommand).toHaveBeenCalledWith('test-project', 'npm run dev');
        } finally {
            await runManager.stop('test-project', '/tmp/onlook-test');
            if (previousUrl === undefined) {
                delete process.env.ANTHROPIC_BASE_URL;
            } else {
                process.env.ANTHROPIC_BASE_URL = previousUrl;
            }
            if (previousModel === undefined) {
                delete process.env.ANTHROPIC_MODEL;
            } else {
                process.env.ANTHROPIC_MODEL = previousModel;
            }
        }
    });

    it('emits the actual development server URL and project ID', () => {
        sendMainWindowMessage.mockClear();
        const detected = actualTerminal.checkSuccess(
            'test-project',
            '\x1b[32m➜ Local:\x1b[0m http://127.0.0.1:5173/',
        );

        expect(detected).toBe(true);
        expect(sendMainWindowMessage).toHaveBeenCalledWith(MainChannels.RUN_STATE_CHANGED, {
            state: RunState.RUNNING,
            message: 'Development server detected.',
            id: 'test-project',
            url: 'http://127.0.0.1:5173/',
        });
    });
});
