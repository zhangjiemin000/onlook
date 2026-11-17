import { describe, expect, it, mock } from 'bun:test';
import path from 'node:path';

const mainRoot = path.resolve(import.meta.dir, '../electron/main');
const handlers = new Map<string, (event: null, args?: any) => any>();
const updateUserSettings = mock((_settings: any) => {});
const updateCredentials = mock((_credentials: { apiKey?: string }) => {});
let storedApiKey: string | undefined;

mock.module('electron', () => ({
    ipcMain: {
        handle: (channel: string, handler: (event: null, args?: any) => any) => {
            handlers.set(channel, handler);
        },
    },
}));
mock.module(path.join(mainRoot, 'analytics/index.ts'), () => ({
    default: { updateUserMetadata: () => {} },
    sendAnalytics: () => {},
}));
mock.module(path.join(mainRoot, 'auth/index.ts'), () => ({
    getRefreshedAuthTokens: async () => null,
}));
mock.module(path.join(mainRoot, 'storage/index.ts'), () => ({
    PersistentStorage: {
        USER_SETTINGS: {
            read: () => ({ chat: { customModel: 'test-model' } }),
            update: updateUserSettings,
        },
        LOCAL_AI_CREDENTIALS: {
            read: () => (storedApiKey ? { apiKey: storedApiKey } : null),
            update: updateCredentials,
        },
        USER_METADATA: { read: () => null, update: () => {} },
        APP_STATE: { read: () => null, replace: () => {} },
        PROJECTS: { read: () => null, update: () => {} },
    },
}));

const { listenForStorageMessages } = await import('../electron/main/events/storage');
const { MainChannels } = await import('@onlook/models/constants');
listenForStorageMessages();

describe('built-in AI credential storage', () => {
    it('keeps custom API tokens out of plain user settings', () => {
        const update = handlers.get(MainChannels.UPDATE_USER_SETTINGS);
        expect(update).toBeDefined();
        updateCredentials.mockImplementation(({ apiKey }) => {
            storedApiKey = apiKey;
        });

        update?.(null, {
            chat: {
                showSuggestions: true,
                autoApplyCode: true,
                expandCodeBlocks: false,
                showMiniChat: true,
                customModel: 'test-model',
                customApiKey: 'secret-token',
            },
        });

        expect(updateCredentials).toHaveBeenCalledWith({ apiKey: 'secret-token' });
        const plainSettings = updateUserSettings.mock.calls[0]?.[0];
        expect(plainSettings?.chat.customModel).toBe('test-model');
        expect(plainSettings?.chat).not.toHaveProperty('customApiKey');

        const get = handlers.get(MainChannels.GET_USER_SETTINGS);
        const restored = get?.(null);
        expect(restored.chat.customApiKey).toBe('secret-token');
        expect(restored.chat.customModel).toBe('test-model');
    });
});
