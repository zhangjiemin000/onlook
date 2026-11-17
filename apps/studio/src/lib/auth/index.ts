import { MainChannels } from '@onlook/models/constants';
import type { UserMetadata } from '@onlook/models/settings';
import { makeAutoObservable } from 'mobx';
import { invokeMainChannel } from '../utils';

export class AuthManager {
    authenticated = true;
    userMetadata: UserMetadata | null = {
        id: 'local-user',
        name: 'Local Developer',
        email: 'local@localhost',
        plan: 'pro',
    };
    isAuthEnabled = false;

    constructor() {
        makeAutoObservable(this);
    }

    async fetchUserMetadata() {
        return;
    }

    listenForAuthEvents() {
        return;
    }

    async signIn(provider: 'github' | 'google') {
        await invokeMainChannel(MainChannels.SIGN_IN, { provider });
    }

    async signOut() {
        return;
    }
}
