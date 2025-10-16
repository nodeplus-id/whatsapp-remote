import { existsSync, readFileSync } from "node:fs";
import path, { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import config from "../config";

export async function injectVersionLock(page: Page) {
    let indexHtmlFile = path.resolve(import.meta.dirname, '../waweb/index.html')
    if (!existsSync(indexHtmlFile)) {
        console.warn(`Wa Web Index not exist, NO version locking`, indexHtmlFile)
        return
    }
    console.debug('Intercept for version locking..')
    const indexURL = 'https://web.whatsapp.com/';
    const content = readFileSync(indexHtmlFile)
    let interceptor = (req) => {
        if (req.url() !== indexURL)
            return req.continue();

        req.respond({
            status: 200,
            contentType: 'text/html',
            body: content
        })
        page.off('request', interceptor)
        page.setRequestInterception(false)
        console.debug('Version lock done.')
    }
    await page.setRequestInterception(true);
    page.on('request', interceptor);

}

export async function injectRemote(page: Page) {

    await page.setBypassCSP(true)
    const scripts: string[] = []
    // Inject Our script
    if (config.isLiveDev) {
        let viteFsRoot = resolve(process.cwd(), 'remote')
        scripts.push(
            `http://127.0.0.1:${config.listenPort}/@vite/client`,
            `http://127.0.0.1:${config.listenPort}/@fs${viteFsRoot}/index.ts`
        )
    } else {
        // untested
        scripts.push(`http://127.0.0.1:${config.listenPort}/remote/index.js`);
    }

    await page.evaluateOnNewDocument((srcs: string[]) => {
        window.addEventListener('DOMContentLoaded', () => {
            console.log('✅ inject remote ON');
            const _f = (s) => {
                const script = document.createElement('script');
                script.type = 'module'
                script.src = s
                document.documentElement.appendChild(script);
            }
            srcs.forEach(_f)
        });
    }, scripts);
}