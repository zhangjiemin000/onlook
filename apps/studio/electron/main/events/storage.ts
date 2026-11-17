import { DefaultSettings, MainChannels } from '@onlook/models/constants';
import type { AppState, UserMetadata, UserSettings } from '@onlook/models/settings';
import { ipcMain } from 'electron';
import mixpanel from '../analytics';
import { getRefreshedAuthTokens } from '../auth';
import { PersistentStorage } from '../storage';

export function listenForStorageMessages() {
    ipcMain.handle(MainChannels.GET_USER_SETTINGS, (e: Electron.IpcMainInvokeEvent) => {
        const settings = PersistentStorage.USER_SETTINGS.read();
        const apiKey = PersistentStorage.LOCAL_AI_CREDENTIALS.read()?.apiKey;
        if (!apiKey) {
            return settings;
        }
        return {
            ...settings,
            chat: {
                ...DefaultSettings.CHAT_SETTINGS,
                ...settings?.chat,
                customApiKey: apiKey,
            },
        };
    });

    ipcMain.handle(
        MainChannels.UPDATE_USER_SETTINGS,
        (e: Electron.IpcMainInvokeEvent, args: Partial<UserSettings>) => {
            if (args.chat && 'customApiKey' in args.chat) {
                const { customApiKey, ...chat } = args.chat;
                PersistentStorage.LOCAL_AI_CREDENTIALS.update({
                    apiKey: customApiKey?.trim() || undefined,
                });
                PersistentStorage.USER_SETTINGS.update({ ...args, chat });
                return;
            }
            PersistentStorage.USER_SETTINGS.update(args);
        },
    );

    ipcMain.handle(MainChannels.GET_USER_METADATA, (e: Electron.IpcMainInvokeEvent) => {
        return PersistentStorage.USER_METADATA.read();
    });

    ipcMain.handle(
        MainChannels.UPDATE_USER_METADATA,
        (e: Electron.IpcMainInvokeEvent, args: Partial<UserMetadata>) => {
            PersistentStorage.USER_METADATA.update(args);
            mixpanel.updateUserMetadata(args);
        },
    );

    ipcMain.handle(MainChannels.GET_APP_STATE, (e: Electron.IpcMainInvokeEvent) => {
        return PersistentStorage.APP_STATE.read();
    });

    ipcMain.handle(MainChannels.IS_USER_SIGNED_IN, (e: Electron.IpcMainInvokeEvent) => {
        return getRefreshedAuthTokens();
    });

    ipcMain.handle(
        MainChannels.REPLACE_APP_STATE,
        (e: Electron.IpcMainInvokeEvent, args: AppState) => {
            PersistentStorage.APP_STATE.replace(args);
        },
    );

    ipcMain.handle(MainChannels.GET_PROJECTS, (e: Electron.IpcMainInvokeEvent) => {
        return PersistentStorage.PROJECTS.read();
    });

    ipcMain.handle(MainChannels.UPDATE_PROJECTS, (e: Electron.IpcMainInvokeEvent, args: any) => {
        PersistentStorage.PROJECTS.update(args);
    });
}
