import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';

async function dump() {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Serve a simple HTML file that mimics the baseline
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AccessAudit Test Fixtures</title>
  </head>
  <body>
    <div id="root">
        <div>
            <div>
              <label for="email-field">Email</label>
              <input id="email-field" />
            </div>
            <div class="search-bar">
              <div class="btn">Search</div>
            </div>
            <div class="card-click-area">
              <h2>Article Title</h2>
              <p>Summary of the article goes here...</p>
              <span>Read more</span>
            </div>
            <div>Submit</div>
            <span>Action</span>
            <div>Click me<a href="/somewhere">Or click here</a></div>
        </div>
    </div>
  </body>
</html>`;
    
    fs.writeFileSync('temp.html', html);
    await page.goto('file://' + process.cwd() + '/temp.html');
    
    const baselineResults = await new AxeBuilder({ page }).analyze();
    fs.writeFileSync('datasets/axe_baseline.json', JSON.stringify(baselineResults.violations, null, 2));

    // Post-patch HTML
    const htmlPost = html.replace('<div class="btn">Search</div>', '<button class="btn">Search</button>');
    fs.writeFileSync('temp2.html', htmlPost);
    await page.goto('file://' + process.cwd() + '/temp2.html');
    
    const postResults = await new AxeBuilder({ page }).analyze();
    fs.writeFileSync('datasets/axe_post.json', JSON.stringify(postResults.violations, null, 2));
    
    await browser.close();
    console.log("Done");
}

dump().catch(console.error);
