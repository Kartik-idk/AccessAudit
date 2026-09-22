import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

async function run() {
    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();
    
    // Inject test HTML
    await page.setContent('<input type="text" aria-hidden="true" id="c3-input" />');
    
    const baselineAxe = await new AxeBuilder({ page }).analyze();
    console.log("Violations found:");
    for (const v of baselineAxe.violations) {
       console.log(`- ${v.id}: ${v.nodes.map(n=>n.html).join(', ')}`);
    }
    await browser.close();
}
run();
