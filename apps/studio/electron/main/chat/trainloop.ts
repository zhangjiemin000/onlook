import { BASE_PROXY_ROUTE, FUNCTIONS_ROUTE, ProxyRoutes } from '@onlook/models/constants';
import { Client, type SampleFeedbackType } from '@trainloop/sdk';
import type { CoreMessage } from 'ai';
import { getRefreshedAuthTokens } from '../auth';

class TrainLoopManager {
    private static instance: TrainLoopManager;

    private constructor() {}

    async getClient() {
        if (!import.meta.env.VITE_SUPABASE_API_URL) {
            return null;
        }
        const proxyUrl = `${import.meta.env.VITE_SUPABASE_API_URL}${FUNCTIONS_ROUTE}${BASE_PROXY_ROUTE}${ProxyRoutes.TRAINLOOP}`;
        const authTokens = await getRefreshedAuthTokens();
        if (!authTokens) {
            return null;
        }
        return new Client(authTokens.accessToken, proxyUrl);
    }

    public static getInstance(): TrainLoopManager {
        if (!TrainLoopManager.instance) {
            TrainLoopManager.instance = new TrainLoopManager();
        }
        return TrainLoopManager.instance;
    }

    public async saveApplyResult(messages: CoreMessage[], type: SampleFeedbackType) {
        const client = await this.getClient();
        if (!client) {
            return;
        }
        await client.sendData(
            messages as unknown as Record<string, string>[],
            type,
            'onlook-apply-set',
        );
    }
}

export default TrainLoopManager.getInstance();
