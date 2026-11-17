import { MainChannels } from '@onlook/models/constants';
import { RunState } from '@onlook/models/run';
import * as pty from 'node-pty';
import os from 'os';
import { mainWindow } from '..';
import { getBunCommand } from '../bun';
import { getLocalDevServerUrl } from './helpers';

class TerminalManager {
    private static instance: TerminalManager;
    private processes: Map<string, pty.IPty>;
    private outputHistory: Map<string, string>;

    private constructor() {
        this.processes = new Map();
        this.outputHistory = new Map();
    }

    static getInstance(): TerminalManager {
        if (!TerminalManager.instance) {
            TerminalManager.instance = new TerminalManager();
        }
        return TerminalManager.instance;
    }

    create(id: string, options?: { cwd?: string }): boolean {
        try {
            const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/sh';
            const ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-color',
                cwd: options?.cwd,
            });

            ptyProcess.onData((data: string) => {
                this.checkTerminalState(id, data);
                this.addTerminalMessage(id, data);
            });

            this.processes.set(id, ptyProcess);
            return true;
        } catch (error) {
            console.error('Failed to create terminal.', error);
            return false;
        }
    }

    checkTerminalState(id: string, data: string) {
        if (this.shouldIgnoreCheck(data)) {
            return;
        }
        const errorFound = this.checkError(data);
        if (errorFound) {
            return;
        }
        this.checkSuccess(id, data);
    }

    shouldIgnoreCheck(data: string) {
        const ignorePatterns = ['[webpack.cache.PackFileCacheStrategy]'];
        return ignorePatterns.some((pattern) => data.toLowerCase().includes(pattern.toLowerCase()));
    }

    checkError(data: string) {
        // Critical CLI errors
        const errorPatterns = [
            'command not found',
            'ENOENT:',
            'fatal:',
            'error:',

            // Critical Node.js errors
            'TypeError:',
            'ReferenceError:',
            'SyntaxError:',
            'Cannot find module',
            'Module not found',

            // Critical React/Next.js errors
            'Failed to compile',
            'Build failed',
            'Invalid hook call',
            'Invalid configuration',

            // Critical Package errors
            'npm ERR!',
            'yarn error',
            'pnpm ERR!',
            'Missing dependencies',

            // Critical TypeScript errors
            'TS2304:', // Cannot find name
            'TS2307:', // Cannot find module
        ];

        let errorFound = false;
        if (errorPatterns.some((pattern) => data.toLowerCase().includes(pattern.toLowerCase()))) {
            mainWindow?.webContents.send(MainChannels.RUN_STATE_CHANGED, {
                state: RunState.ERROR,
                message: `Command error detected: ${data.trim()}`,
            });
            errorFound = true;
        }
        return errorFound;
    }

    checkSuccess(id: string, data: string): boolean {
        const localUrl = getLocalDevServerUrl(data);
        if (localUrl) {
            mainWindow?.webContents.send(MainChannels.RUN_STATE_CHANGED, {
                state: RunState.RUNNING,
                message: 'Development server detected.',
                id,
                url: localUrl,
            });
            return true;
        }

        const plainText = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
            .trim()
            .toLowerCase();
        if (plainText.includes('get / 200')) {
            mainWindow?.webContents.send(MainChannels.RUN_STATE_CHANGED, {
                state: RunState.RUNNING,
                message: 'Command executed successfully.',
            });
            return true;
        }
        return false;
    }

    addTerminalMessage(id: string, data: string) {
        const currentHistory = this.getHistory(id) || '';
        this.outputHistory.set(id, currentHistory + data);
        this.emitMessage(id, data);
    }

    emitMessage(id: string, data: string) {
        mainWindow?.webContents.send(MainChannels.TERMINAL_ON_DATA, {
            id,
            data,
        });
    }

    write(id: string, data: string): boolean {
        try {
            this.processes.get(id)?.write(data);
            return true;
        } catch (error) {
            console.error('Failed to write to terminal.', error);
            return false;
        }
    }

    resize(id: string, cols: number, rows: number): boolean {
        try {
            this.processes.get(id)?.resize(cols, rows);
            return true;
        } catch (error) {
            console.error('Failed to resize terminal.', error);
            return false;
        }
    }

    kill(id: string): boolean {
        try {
            const process = this.processes.get(id);
            if (process) {
                process.kill();
                this.processes.delete(id);
                this.outputHistory.delete(id);
            }
            return true;
        } catch (error) {
            console.error('Failed to kill terminal.', error);
            return false;
        }
    }

    killAll(): boolean {
        this.processes.forEach((process) => process.kill());
        this.processes.clear();
        return true;
    }

    executeCommand(id: string, command: string): boolean {
        try {
            const commandToExecute = getBunCommand(command);
            const newline = os.platform() === 'win32' ? '\r\n' : '\n';
            return this.write(id, commandToExecute + newline);
        } catch (error) {
            console.error('Failed to execute command.', error);
            return false;
        }
    }

    getHistory(id: string): string | undefined {
        return this.outputHistory.get(id);
    }
}

export default TerminalManager.getInstance();
