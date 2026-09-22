import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
async function run() {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:5173');
    const baselineAxe = await new AxeBuilder({ page }).analyze();
    console.log("Violations found:", baselineAxe.violations.length);
    for (const v of baselineAxe.violations) {
        console.log(v.id, v.nodes.map(n=>n.target));
    }
    await browser.close();
}
run();
