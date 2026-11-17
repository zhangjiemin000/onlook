import { parse } from '@babel/parser';
import { extractCodeBlocks } from '@onlook/ai/src/coder';
import { PAGE_SYSTEM_PROMPT, PromptProvider } from '@onlook/ai/src/prompt';
import { CreateStage, type CreateCallback, type CreateProjectResponse } from '@onlook/models';
import {
    StreamRequestType,
    type ErrorStreamResponse,
    type ImageMessageContext,
    type PartialStreamResponse,
    type RateLimitedStreamResponse,
} from '@onlook/models/chat';
import { MainChannels } from '@onlook/models/constants';
import type { CoreMessage, CoreSystemMessage } from 'ai';
import fs from 'fs';
import path from 'path';
import { mainWindow } from '..';
import Chat from '../chat';
import { getCreateProjectPath } from './helpers';
import { createProject } from './install';

export class ProjectCreator {
    private static instance: ProjectCreator;
    private abortController: AbortController | null = null;

    public static getInstance(): ProjectCreator {
        if (!ProjectCreator.instance) {
            ProjectCreator.instance = new ProjectCreator();
        }
        return ProjectCreator.instance;
    }

    private async executeProjectCreation<T>(
        action: (controller: AbortController) => Promise<T>,
    ): Promise<{
        success: boolean;
        error?: string;
        response?: T;
        cancelled?: boolean;
    }> {
        this.cancel();
        const controller = new AbortController();
        this.abortController = controller;

        try {
            const result = await action(controller);
            return { success: true, response: result };
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return { success: false, cancelled: true };
            }
            console.error('Failed to create project:', error);
            return { success: false, error: (error as Error).message };
        } finally {
            if (this.abortController === controller) {
                this.abortController = null;
            }
        }
    }

    public async createProject(
        prompt: string,
        images: ImageMessageContext[],
    ): Promise<CreateProjectResponse> {
        return this.executeProjectCreation(async (controller) => {
            const [generatedPage, projectPath] = await Promise.all([
                this.generatePage(controller, prompt, images).catch((error) => ({ error })),
                this.runCreate(controller),
            ]);

            if (controller.signal.aborted) {
                throw new DOMException('Project creation cancelled', 'AbortError');
            }

            if ('error' in generatedPage) {
                const reason =
                    generatedPage.error instanceof Error
                        ? generatedPage.error.message
                        : String(generatedPage.error);
                const warning = `AI page generation was skipped: ${reason}. The starter project is ready to run without AI.`;
                console.warn(warning);
                this.emitPromptProgress('AI unavailable. Opening the starter project...', 100);
                return { projectPath, content: '', warning };
            }

            await this.applyGeneratedPage(projectPath, generatedPage);
            return { projectPath, content: generatedPage.content };
        });
    }

    public async createBlankProject(): Promise<CreateProjectResponse> {
        return this.executeProjectCreation(async (controller) => {
            const projectPath = await this.runCreate(controller);
            return { projectPath, content: '' };
        });
    }

    public cancel(): void {
        this.abortController?.abort();
    }

    private async generatePage(
        parentController: AbortController,
        prompt: string,
        images: ImageMessageContext[],
    ): Promise<{ path: string; content: string }> {
        const messages = this.getMessages(prompt, images);
        this.emitPromptProgress('Generating page...', 10);
        const systemPrompt = new PromptProvider().getCreatePageSystemPrompt();
        const systemMessage: CoreSystemMessage = {
            role: 'system',
            content: systemPrompt,
            experimental_providerMetadata: {
                anthropic: { cacheControl: { type: 'ephemeral' } },
            },
        };

        const generationController = new AbortController();
        const forwardAbort = () => generationController.abort();
        if (parentController.signal.aborted) {
            forwardAbort();
        } else {
            parentController.signal.addEventListener('abort', forwardAbort, { once: true });
        }
        const timeout = setTimeout(() => generationController.abort(), 60_000);

        try {
            const response = await Chat.stream(
                [systemMessage, ...messages],
                StreamRequestType.CREATE,
                {
                    abortController: generationController,
                    skipSystemPrompt: true,
                },
            );

            if (response.type !== 'full') {
                throw new Error('Failed to generate page. ' + this.getStreamErrorMessage(response));
            }

            const content = extractCodeBlocks(response.text);
            if (!content.trim()) {
                throw new Error('AI returned an empty page. The starter page was preserved.');
            }
            parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

            return {
                path: PAGE_SYSTEM_PROMPT.defaultPath,
                content,
            };
        } finally {
            clearTimeout(timeout);
            parentController.signal.removeEventListener('abort', forwardAbort);
        }
    }

    private async runCreate(controller: AbortController): Promise<string> {
        if (controller.signal.aborted) {
            throw new DOMException('Project creation cancelled', 'AbortError');
        }

        const projectsPath = getCreateProjectPath();
        await fs.promises.mkdir(projectsPath, { recursive: true });
        const projectName = `project-${Date.now()}`;

        await createProject(projectName, projectsPath, this.createCallback.bind(this));
        return path.join(projectsPath, projectName);
    }

    private createCallback: CreateCallback = (stage: CreateStage, message: string) => {
        let progress = 0;
        switch (stage) {
            case CreateStage.CLONING:
                progress = 20;
                break;
            case CreateStage.GIT_INIT:
                progress = 30;
                break;
            case CreateStage.INSTALLING:
                progress = 40;
                break;
            case CreateStage.COMPLETE:
                progress = 50;
                this.emitPromptProgress('Project created! Generating page...', progress);
                return;
        }
        this.emitPromptProgress(message, progress);
    };

    private emitPromptProgress = (message: string, progress: number) => {
        mainWindow?.webContents.send(MainChannels.CREATE_NEW_PROJECT_PROMPT_CALLBACK, {
            message,
            progress,
        });
    };

    private getMessages(prompt: string, images: ImageMessageContext[]): CoreMessage[] {
        const promptContent = `${images.length > 0 ? 'Refer to the images above. ' : ''}Create a landing page that matches this description: ${prompt}
Use this as the starting template:
${PAGE_SYSTEM_PROMPT.defaultContent}`;

        // For text-only messages
        if (images.length === 0) {
            return [
                {
                    role: 'user',
                    content: promptContent,
                },
            ];
        }

        // For messages with images
        return [
            {
                role: 'user',
                content: [
                    ...images.map((image) => ({
                        type: 'image' as const,
                        image: image.content,
                        mimeType: image.mimeType,
                    })),
                    {
                        type: 'text' as const,
                        text: promptContent,
                    },
                ],
            },
        ];
    }

    private async applyGeneratedPage(
        projectPath: string,
        generatedPage: { path: string; content: string },
    ): Promise<void> {
        const pagePath = path.join(projectPath, generatedPage.path);
        // Create recursive directories if they don't exist
        await fs.promises.mkdir(path.dirname(pagePath), { recursive: true });
        await fs.promises.writeFile(pagePath, generatedPage.content);
    }

    private getStreamErrorMessage(
        streamResult: PartialStreamResponse | ErrorStreamResponse | RateLimitedStreamResponse,
    ): string {
        if (streamResult.type === 'error') {
            return streamResult.message;
        }

        if (streamResult.type === 'rate-limited') {
            if (streamResult.rateLimitResult) {
                const requestLimit =
                    streamResult.rateLimitResult.reason === 'daily'
                        ? streamResult.rateLimitResult.daily_requests_limit
                        : streamResult.rateLimitResult.monthly_requests_limit;

                return `You reached your ${streamResult.rateLimitResult.reason} ${requestLimit} message limit.`;
            }
            return 'Rate limit exceeded. Please try again later.';
        }

        if (streamResult.type === 'partial') {
            return 'Returned partial response';
        }

        return 'Unknown error';
    }
}

export default ProjectCreator.getInstance();
