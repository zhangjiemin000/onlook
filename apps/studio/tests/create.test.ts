import { beforeEach, describe, expect, it, mock } from 'bun:test';
import os from 'node:os';
import path from 'node:path';

const mainRoot = path.resolve(import.meta.dir, '../electron/main');
const aiError = 'Model unavailable';
let installError: string | null = null;
let installGate: (() => Promise<void>) | null = null;
let streamImplementation: (options: { abortController: AbortController }) => Promise<any>;

function failAiRequest() {
    streamImplementation = async ({ abortController }) => {
        abortController.abort();
        return { type: 'error', message: aiError };
    };
}

failAiRequest();

mock.module(path.join(mainRoot, 'index.ts'), () => ({ mainWindow: null }));
mock.module(path.join(mainRoot, 'chat/index.ts'), () => ({
    default: {
        stream: (
            _messages: any,
            _requestType: any,
            options: { abortController: AbortController },
        ) => streamImplementation(options),
    },
}));
mock.module(path.join(mainRoot, 'create/install.ts'), () => ({
    createProject: async () => {
        await installGate?.();
        if (installError) {
            throw new Error(installError);
        }
    },
}));
mock.module(path.join(mainRoot, 'create/helpers.ts'), () => ({
    getCreateProjectPath: () => path.join(os.tmpdir(), 'onlook-create-test'),
}));

const { ProjectCreator } = await import('../electron/main/create/index');

beforeEach(() => {
    installError = null;
    installGate = null;
    failAiRequest();
});

describe('ProjectCreator optional AI', () => {
    it('keeps the starter project when AI generation aborts its own request', async () => {
        const result = await ProjectCreator.getInstance().createProject('Create a test page', []);

        expect(result.success).toBe(true);
        expect(result.response?.projectPath).toContain('onlook-create-test');
        expect(result.response?.content).toBe('');
        expect(result.response?.warning).toContain('Model unavailable');
        expect(result.response?.warning).toContain('ready to run without AI');
    });

    it('does not convert explicit cancellation into fallback success', async () => {
        streamImplementation = ({ abortController }) =>
            new Promise((_, reject) => {
                abortController.signal.addEventListener(
                    'abort',
                    () => reject(new DOMException('Request aborted', 'AbortError')),
                    { once: true },
                );
            });
        const creator = ProjectCreator.getInstance();
        const pending = creator.createProject('Create a test page', []);
        await new Promise((resolve) => setTimeout(resolve, 0));
        creator.cancel();
        const result = await pending;

        expect(result.success).toBe(false);
        expect(result.cancelled).toBe(true);
        expect(result.response).toBeUndefined();
    });

    it('keeps overlapping creation controllers independent', async () => {
        const installResolvers: (() => void)[] = [];
        installGate = () =>
            new Promise<void>((resolve) => {
                installResolvers.push(resolve);
            });
        const creator = ProjectCreator.getInstance();
        const first = creator.createProject('First project', []);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const second = creator.createProject('Second project', []);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(installResolvers).toHaveLength(2);

        installResolvers[0]?.();
        const firstResult = await first;
        expect(firstResult.cancelled).toBe(true);

        creator.cancel();
        installResolvers[1]?.();
        const secondResult = await second;
        expect(secondResult.cancelled).toBe(true);
    });

    it('preserves the starter when AI returns invalid TSX', async () => {
        streamImplementation = async () => ({
            type: 'full',
            text: '```tsx\nexport default function Broken( {\n```',
        });
        const result = await ProjectCreator.getInstance().createProject('Create a test page', []);

        expect(result.success).toBe(true);
        expect(result.response?.content).toBe('');
        expect(result.response?.warning).toContain('starter project is ready to run without AI');
    });

    it('still reports local project creation failures', async () => {
        installError = 'Template download failed';
        const result = await ProjectCreator.getInstance().createProject('Create a test page', []);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Template download failed');
        expect(result.response).toBeUndefined();
    });
});
