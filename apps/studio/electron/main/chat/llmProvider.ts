import { createAnthropic } from '@ai-sdk/anthropic';
import type { LocalGatewayTestResult, StreamRequestType } from '@onlook/models/chat';
import { CLAUDE_MODELS, LLMProvider } from '@onlook/models/llm';
import { generateText, type LanguageModelV1 } from 'ai';
import { z } from 'zod';
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
        PersistentStorage.LOCAL_AI_CREDENTIALS.read()?.apiKey?.trim() ||
        import.meta.env.VITE_ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        fileEnv.ANTHROPIC_API_KEY ||
        fileEnv.ANTHROPIC_AUTH_TOKEN ||
        'local-proxy';

    return {
        baseUrl,
        token,
        primaryModel:
            customModel ||
            process.env.ANTHROPIC_MODEL ||
            fileEnv.ANTHROPIC_MODEL ||
            process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
            fileEnv.ANTHROPIC_DEFAULT_SONNET_MODEL,
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
        model === CLAUDE_MODELS.HAIKU ? gateway.haikuModel : gateway.primaryModel;

    if (!resolvedModelId) {
        throw new Error(
            'Built-in AI is not configured. Set a model in Settings → Preferences, or use an external agent. Project preview does not require a model.',
        );
    }

    const anthropic = createAnthropic({
        baseURL: gateway.baseUrl,
        apiKey: gateway.token,
    });

    return anthropic(resolvedModelId, {
        cacheControl: true,
    });
}

export async function testLocalGateway(): Promise<LocalGatewayTestResult> {
    const gateway = resolveLocalGatewayConfig();
    const model = gateway.primaryModel;
    if (!model) {
        return {
            success: false,
            message: 'No model configured. Project preview and external agent tools still work.',
        };
    }

    try {
        const anthropic = createAnthropic({
            baseURL: gateway.baseUrl,
            apiKey: gateway.token,
        });
        const { toolCalls } = await generateText({
            model: anthropic(model, { cacheControl: true }),
            prompt: 'Use the connection_test tool exactly once. Do not answer in plain text.',
            maxTokens: 256,
            abortSignal: AbortSignal.timeout(15_000),
            tools: {
                connection_test: {
                    description: 'Verify that the selected model can call Onlook tools.',
                    parameters: z.object({}),
                    execute: async () => ({ success: true }),
                },
            },
        });
        if (toolCalls.length === 0) {
            return {
                success: false,
                message: 'The model responded but did not call the required test tool.',
                model,
            };
        }
        return {
            success: true,
            message: 'Model connection and tool calling are working.',
            model,
        };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : String(error),
            model,
        };
    }
}
