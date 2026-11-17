import { createAnthropic } from '@ai-sdk/anthropic';
import type { StreamRequestType } from '@onlook/models/chat';
import { CLAUDE_MODELS, LLMProvider } from '@onlook/models/llm';
import { type LanguageModelV1 } from 'ai';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { PersistentStorage } from '../storage';

export interface OnlookPayload {
    requestType: StreamRequestType;
}

interface LocalGatewayEnv {
    baseUrl: string;
    token: string;
    primaryModel?: string;
    haikuModel?: string;
}

function resolveLocalGatewayConfig(): LocalGatewayEnv {
    let fileEnv: Record<string, string> = {};
    try {
        const candidateHomes = Array.from(new Set([userInfo().homedir, homedir()]));
        for (const home of candidateHomes) {
            const settingsPath = join(home, '.claude', 'settings.json');
            if (existsSync(settingsPath)) {
                const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
                if (parsed && typeof parsed.env === 'object') {
                    fileEnv = parsed.env;
                    break;
                }
            }
        }
    } catch (error) {
        console.warn('Could not read local gateway settings, using defaults:', error);
    }

    const userSettings = PersistentStorage.USER_SETTINGS.read() || {};
    const customProxyUrl = userSettings.chat?.customProxyUrl?.trim();
    const customModel = userSettings.chat?.customModel?.trim();

    const rawBase =
        customProxyUrl ||
        import.meta.env.VITE_LOCAL_PROXY_URL ||
        process.env.ANTHROPIC_BASE_URL ||
        fileEnv.ANTHROPIC_BASE_URL ||
        'http://127.0.0.1:15721';

    const trimmed = rawBase.replace(/\/+$/, '');
    const baseUrl = trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;

    const token =
        import.meta.env.VITE_ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        fileEnv.ANTHROPIC_API_KEY ||
        fileEnv.ANTHROPIC_AUTH_TOKEN ||
        'local-proxy';

    const resolvedDefaultModel =
        customModel ||
        process.env.ANTHROPIC_MODEL ||
        fileEnv.ANTHROPIC_MODEL ||
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
        fileEnv.ANTHROPIC_DEFAULT_SONNET_MODEL;

    return {
        baseUrl,
        token,
        primaryModel: resolvedDefaultModel,
        haikuModel:
            customModel ||
            process.env.ANTHROPIC_MODEL ||
            fileEnv.ANTHROPIC_MODEL ||
            process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
            fileEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    };
}

export async function initModel(
    provider: LLMProvider,
    model: CLAUDE_MODELS,
    payload: OnlookPayload,
): Promise<LanguageModelV1> {
    switch (provider) {
        case LLMProvider.ANTHROPIC:
            return await getAnthropicProvider(model, payload);
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

async function getAnthropicProvider(
    model: CLAUDE_MODELS,
    _payload: OnlookPayload,
): Promise<LanguageModelV1> {
    const gateway = resolveLocalGatewayConfig();
    const resolvedModelId =
        model === CLAUDE_MODELS.HAIKU
            ? gateway.haikuModel || model
            : gateway.primaryModel || model;

    const anthropic = createAnthropic({
        baseURL: gateway.baseUrl,
        apiKey: gateway.token,
    });

    return anthropic(resolvedModelId, {
        cacheControl: true,
    });
}
