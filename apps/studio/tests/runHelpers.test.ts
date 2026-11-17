import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLocalDevServerUrl, getValidFiles } from '../electron/main/run/helpers';

const temporaryRoots: string[] = [];

function createTemporaryRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlook-run-scan-'));
    temporaryRoots.push(root);
    return root;
}

afterEach(() => {
    for (const root of temporaryRoots) {
        fs.rmSync(root, { recursive: true, force: true });
    }
    temporaryRoots.length = 0;
});

describe('Run project file scanning', () => {
    it('ignores virtual environments and skips broken symlinks', async () => {
        const root = createTemporaryRoot();
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.mkdirSync(path.join(root, '.venv', 'bin'), { recursive: true });
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(root, 'app.tsx'), 'export default function App() {}');
        fs.writeFileSync(
            path.join(root, 'src', 'Component.tsx'),
            'export const Component = () => null;',
        );
        fs.writeFileSync(path.join(root, '.venv', 'bin', 'ignored.tsx'), 'not project code');

        const missingTarget = path.join(root, 'missing-target');
        fs.symlinkSync(missingTarget, path.join(root, '.venv', 'bin', 'python'));
        fs.symlinkSync(missingTarget, path.join(root, 'node_modules', 'broken'));
        fs.symlinkSync(missingTarget, path.join(root, 'venv'));
        fs.symlinkSync(missingTarget, path.join(root, 'stale-link'));

        const files = await getValidFiles(root);

        expect(files.sort()).toEqual(
            [path.join(root, 'app.tsx'), path.join(root, 'src', 'Component.tsx')].sort(),
        );
        expect(files.some((file) => file.includes(`${path.sep}.venv${path.sep}`))).toBe(false);
        expect(files.some((file) => file.includes('stale-link'))).toBe(false);
    });

    it('detects the actual local Vite URL in terminal output', () => {
        expect(getLocalDevServerUrl('\x1b[32m➜ Local:\x1b[0m http://127.0.0.1:5173/')).toBe(
            'http://127.0.0.1:5173/',
        );
        expect(getLocalDevServerUrl('Local: http://localhost:3000/app/')).toBe(
            'http://localhost:3000/app/',
        );
        expect(getLocalDevServerUrl('Network: http://192.168.1.20:5173/')).toBeNull();
    });
});
