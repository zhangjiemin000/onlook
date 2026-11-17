import { beforeEach, describe, expect, it, mock } from 'bun:test';
import path from 'node:path';

const libRoot = path.resolve(import.meta.dir, '../src/lib');
let invokeImplementation: (channel: string, args?: any) => Promise<any>;

mock.module(path.join(libRoot, 'projects/index.ts'), () => ({
    ProjectTabs: { PROJECTS: 'projects' },
}));
mock.module(path.join(libRoot, 'utils/index.ts'), () => ({
    invokeMainChannel: (channel: string, args?: any) => invokeImplementation(channel, args),
    sendAnalytics: () => {},
}));
mock.module('@onlook/ui/use-toast', () => ({ toast: () => {} }));

const { CreateManager, CreateState } = await import('../src/lib/projects/create');
const { MainChannels } = await import('@onlook/models/constants');

function createManager(projectsManager: any) {
    const manager = Object.create(CreateManager.prototype) as any;
    Object.defineProperty(manager, 'state', {
        value: CreateState.PROMPT,
        writable: true,
        configurable: true,
    });
    manager.projectsManager = projectsManager;
    manager.operationId = 0;
    manager.error = null;
    manager.progress = 0;
    manager.message = null;
    manager.slowConnectionTimer = null;
    return manager;
}

beforeEach(() => {
    invokeImplementation = async () => ({ success: false, cancelled: true });
});

describe('CreateManager cancellation state', () => {
    it('does not turn cancellation into an error when the response arrives', async () => {
        let resolveCreation: ((result: any) => void) | undefined;
        invokeImplementation = async (channel) => {
            if (channel === MainChannels.CREATE_NEW_BLANK_PROJECT) {
                return new Promise((resolve) => {
                    resolveCreation = resolve;
                });
            }
            return { success: true };
        };
        const manager = createManager({});
        const pending = manager.sendPrompt('', [], true);
        await manager.cancel();
        resolveCreation?.({ success: false, cancelled: true });
        await pending;

        expect(manager.state).toBe(CreateState.PROMPT);
        expect(manager.state).not.toBe(CreateState.ERROR);
    });

    it('ignores stale results from an older creation operation', async () => {
        const creationResolvers: ((result: any) => void)[] = [];
        invokeImplementation = async (channel) => {
            if (channel === MainChannels.CREATE_NEW_BLANK_PROJECT) {
                return new Promise((resolve) => {
                    creationResolvers.push(resolve);
                });
            }
            return { success: true };
        };
        const projectsManager = { createProject: mock(() => ({})) };
        const manager = createManager(projectsManager);
        const first = manager.sendPrompt('', [], true);
        const second = manager.sendPrompt('', [], true);
        expect(creationResolvers).toHaveLength(2);

        creationResolvers[0]?.({
            success: true,
            response: { projectPath: '/old-project', content: '' },
        });
        await first;
        expect(projectsManager.createProject).not.toHaveBeenCalled();
        expect(manager.state).toBe(CreateState.CREATE_LOADING);

        creationResolvers[1]?.({ success: false, cancelled: true });
        await second;
        expect(manager.state).toBe(CreateState.PROMPT);
    });
});
