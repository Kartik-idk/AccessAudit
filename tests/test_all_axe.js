import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

async function run() {
    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();
    
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(1000); // let react render
    
    const results = await new AxeBuilder({ page }).analyze();
    console.log("Violations detected:");
    for (const v of results.violations) {
        console.log(`- Rule: ${v.id}, Impact: ${v.impact}`);
        for (const n of v.nodes) {
            console.log(`  Target: ${n.target}`);
        }
    }
    
    await browser.close();
}
run();
