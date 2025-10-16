import { existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import os from "node:os";

export function getBrowserPath(): string | null {
    // Detect command line args
    const args = process.argv.slice(2);
    const browserPathArg = args.find(arg => arg.startsWith('--browser='));
    const cliPath = browserPathArg?.split('=')[1];

    if (cliPath) {
        if (existsSync(cliPath)) {
            return cliPath;
        }
        console.debug(`Browser specified by user is not exists: ${cliPath}, fallback to auto detect.`)
    }

    const platform = os.platform();

    if (platform === 'win32') {
        const winPaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
        ];
        return winPaths.find(p => existsSync(p)) || null;
    }

    if (platform === 'darwin') {
        const macPaths = [
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ];
        return macPaths.find(p => existsSync(p)) || null;
    }

    if (platform === 'linux') {
        const linuxPaths = [
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
        ];
        return linuxPaths.find(p => existsSync(p)) || null;
    }
    return null;
}

export async function getPackageJson(): Promise<typeof import('../../package.json')> {
    let packageFile = path.join(process.cwd(), 'package.json')
    if (!existsSync(packageFile)) {
        // Check the parent
        packageFile = path.join(process.cwd(), '../package.json')
        if (!existsSync(packageFile)) {
            console.warn('package.json Not found')
            return Object.create(null)
        }
    }

    return import(url.pathToFileURL(packageFile).href, { with: { type: 'json' } })
        .then(M => M.default)
}