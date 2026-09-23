import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import dns from 'dns';
import ipaddr from 'ipaddr.js';

const MODEL = "qwen2.5-coder:7b";
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";

const WCAG_CRITERIA_MAP = {
    'wcag111': '1.1.1 Non-text Content',
    'wcag131': '1.3.1 Info and Relationships',
    'wcag143': '1.4.3 Contrast (Minimum)',
    'wcag244': '2.4.4 Link Purpose (In Context)',
    'wcag412': '4.1.2 Name, Role, Value'
};
const SELECTED_TAGS = Object.keys(WCAG_CRITERIA_MAP);

const SYSTEM_PROMPT = `You are providing remediation guidance for a rendered webpage audit.
You do not have access to the website's source repository.
You MUST distinguish observed evidence from recommendations.
Do not generate source patches.
Do not invent source filenames, line numbers, framework components, CSS classes, design tokens, or exact replacement HTML unless those facts are explicitly present in the supplied evidence.
Do not generate inline CSS as a proposed patch.
For contrast findings, do not invent foreground/background colors.
Explain the conceptual change the developer should make in the site's stylesheet/design system.
The recommendation has NOT been applied.
The recommendation has NOT been verified.
Axe is the authoritative source for the accessibility finding.

Reply with ONLY a valid JSON object. No markdown, no prose.
Schema:
{
  "problem": "<clear 1-sentence explanation of what is wrong>",
  "why_it_matters": "<1-sentence impact on the user>",
  "remediation_strategy": "<Conceptual actionable instruction. Explain what should be changed in the source/design.>",
  "observed_dom": "<example snippet of bad code from the observed evidence, if applicable>",
  "manual_review": <boolean, true if the rule inherently requires human judgment or was flagged as 'incomplete'>,
  "manual_review_reason": "<if manual_review is true, explain what the human should check>"
}`;

// --- SSRF Hardening ---
// Note: Time-of-check to time-of-use (DNS rebinding) is an unavoidable limitation without a custom network resolver in Playwright. 
// We mitigate by strict IP blocking during route interception for every single request.
async function isSafeIp(ipStr) {
    try {
        const addr = ipaddr.parse(ipStr);
        const range = addr.range();
        // Comprehensive block of unsafe ranges for IPv4 and IPv6
        const blockedRanges = [
            'unspecified', 'broadcast', 'multicast', 'linkLocal', 'loopback', 'private', 
            'carrierGradeNat', 'reserved', 'ipv4Mapped', 'rfc6145', 'rfc6052', '6to4', 'teredo'
        ];
        if (blockedRanges.includes(range)) return false;
        
        // Explicitly block 169.254.x.x (AWS/GCP metadata) if ipaddr missed it as linkLocal
        if (addr.kind() === 'ipv4' && ipStr.startsWith('169.254.')) return false;
        if (addr.kind() === 'ipv4' && ipStr.startsWith('127.')) return false;
        if (addr.kind() === 'ipv6' && ipStr === '::1') return false;
        
        return true;
    } catch (e) {
        return false;
    }
}

async function resolveAndCheckSafety(hostname) {
    try {
        const records = await dns.promises.lookup(hostname, { all: true });
        if (records.length === 0) return false;
        for (const record of records) {
            if (!(await isSafeIp(record.address))) return false;
        }
        return true;
    } catch (e) {
        return false; // ENOTFOUND etc.
    }
}

async function validateUrlSafety(urlStr) {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { throw new Error("Invalid URL format"); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error("Only http/https protocols allowed");
    if (parsed.username || parsed.password) throw new Error("Credentials in URL not allowed");
    if (parsed.hostname === 'localhost') throw new Error("Localhost not allowed");
    
    const isSafe = await resolveAndCheckSafety(parsed.hostname);
    if (!isSafe) throw new Error(`Host ${parsed.hostname} resolved to a blocked/private IP space (SSRF prevention)`);
    return parsed.href;
}

// --- DOM Truncation ---
function truncateHtml(html) {
    if (!html || html.length <= 500) return html;
    const originalLen = html.length;
    const start = html.substring(0, 250);
    const end = html.substring(originalLen - 200);
    return `${start}\n... [TRUNCATED from ${originalLen} chars] ...\n${end}`;
}

// --- Inference ---
async function runInference(ruleGroup, abortSignal) {
    const userPrompt = `Axe Rule: ${ruleGroup.id}
WCAG Criterion: ${ruleGroup.criterion}
Impact: ${ruleGroup.impact || 'unknown'}
Description: ${ruleGroup.description}
Status: ${ruleGroup.type === 'incomplete' ? 'NEEDS MANUAL REVIEW (Axe could not be certain)' : 'VIOLATION DETECTED'}
Total Affected Nodes: ${ruleGroup.totalNodes}

${ruleGroup.contrastData ? `Observed Contrast Data:\nForeground: ${ruleGroup.contrastData.fgColor || 'unavailable'}\nBackground: ${ruleGroup.contrastData.bgColor || 'unavailable'}\nRatio: ${ruleGroup.contrastData.contrastRatio || 'unavailable'}\n` : ''}

Representative HTML snippets (up to 5, possibly truncated):
${ruleGroup.snippets.join('\n\n')}

Provide remediation guidance strictly as JSON.`;

    try {
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt }
                ],
                format: 'json',
                stream: false,
                options: { temperature: 0.1 }
            }),
            signal: abortSignal
        });
        
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const data = await response.json();
        
        let clean = data?.message?.content?.trim() || "";
        if (clean.startsWith('```json')) clean = clean.split('```json')[1].split('```')[0];
        else if (clean.startsWith('```')) clean = clean.split('```')[1].split('```')[0];
        return JSON.parse(clean.trim());
    } catch (e) {
        throw new Error(`Inference failed: ${e.message}`);
    }
}

// --- Core Pipeline ---
export async function runRealAudit(rawUrl, onProgress) {
    const TIMEOUTS = { nav: 30000, settle: 5000, axe: 30000, qwen: 60000, overall: 180000 };
    const abortController = new AbortController();
    const overallTimeout = setTimeout(() => abortController.abort(new Error("Overall audit timeout (180s)")), TIMEOUTS.overall);

    let browser = null;
    try {
        onProgress('STATUS', `Validating URL safety...`);
        const safeUrl = await validateUrlSafety(rawUrl);

        onProgress('STATUS', `Launching headless browser...`);
        browser = await chromium.launch();
        const context = await browser.newContext();
        
        // Playwright Request Interception for SSRF on Redirects/Subresources
        await context.route('**/*', async (route) => {
            const reqUrl = route.request().url();
            let p;
            try { p = new URL(reqUrl); } catch(e) { return route.abort('blockedbyclient'); }
            
            // Allow data URIs but not for navigation
            if (p.protocol === 'data:' && route.request().isNavigationRequest()) return route.abort('blockedbyclient');
            if (p.protocol === 'data:') return route.continue();
            
            // Hard block dangerous schemes
            if (['file:', 'ftp:', 'javascript:', 'blob:'].includes(p.protocol)) return route.abort('blockedbyclient');
            if (p.protocol !== 'http:' && p.protocol !== 'https:') return route.abort('blockedbyclient');
            
            // Validate DNS to prevent redirect to internal IP
            const isSafe = await resolveAndCheckSafety(p.hostname);
            if (!isSafe) {
                return route.abort('blockedbyclient');
            }
            
            route.continue();
        });

        const page = await context.newPage();
        
        onProgress('STATUS', `Navigating to ${safeUrl}...`);
        
        const navPromise = page.goto(safeUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.nav });
        await Promise.race([
            navPromise,
            new Promise((_, r) => { abortController.signal.addEventListener('abort', () => r(abortController.signal.reason)) })
        ]);
        
        onProgress('STATUS', `Allowing page to settle for 5s...`);
        await page.waitForTimeout(TIMEOUTS.settle);

        const pageTitle = await page.title().catch(() => 'Unknown Title');
        onProgress('PAGE_INFO', { url: safeUrl, title: pageTitle });

        onProgress('STATUS', `Running axe-core (filtered to 5 WCAG criteria)...`);
        
        const axePromise = new AxeBuilder({ page })
            .withTags(SELECTED_TAGS)
            .analyze();
            
        const axeResult = await Promise.race([
            axePromise,
            new Promise((_, r) => { setTimeout(() => r(new Error("Axe timeout (30s)")), TIMEOUTS.axe); }),
            new Promise((_, r) => { abortController.signal.addEventListener('abort', () => r(abortController.signal.reason)) })
        ]);

        const rawFindings = [];
        const processAxeNode = (rule, type) => {
            // Find which WCAG tag matches
            const wcagTag = rule.tags.find(t => SELECTED_TAGS.includes(t));
            if (!wcagTag) return;
            const criterion = WCAG_CRITERIA_MAP[wcagTag];

            // Enforce DOM truncation and 5-node bound
            let snippets = rule.nodes.slice(0, 5).map(n => truncateHtml(n.html));
            
            // Extract contrast evidence if available
            let contrastData = null;
            if (rule.id === 'color-contrast' && rule.nodes[0]) {
                const node = rule.nodes[0];
                const contrastCheck = (node.any || []).concat(node.all || []).find(c => c.id === 'color-contrast');
                if (contrastCheck && contrastCheck.data) {
                    contrastData = {
                        fgColor: contrastCheck.data.fgColor,
                        bgColor: contrastCheck.data.bgColor,
                        contrastRatio: contrastCheck.data.contrastRatio
                    };
                }
            }
            
            rawFindings.push({
                id: rule.id,
                description: rule.description,
                impact: rule.impact,
                type: type, // 'violation' or 'incomplete'
                criterion: criterion,
                totalNodes: rule.nodes.length,
                snippets: snippets,
                contrastData: contrastData
            });
        };

        axeResult.violations.forEach(r => processAxeNode(r, 'violation'));
        axeResult.incomplete.forEach(r => processAxeNode(r, 'incomplete'));

        onProgress('AXE_RESULTS', { 
            totalFound: rawFindings.length, 
            violations: axeResult.violations.length,
            incomplete: axeResult.incomplete.length
        });

        if (rawFindings.length === 0) {
            clearTimeout(overallTimeout);
            return { status: 'CLEAN', message: 'No violations found for the 5 selected criteria.' };
        }

        const finalFindings = [];
        
        for (let i = 0; i < rawFindings.length; i++) {
            const ruleGroup = rawFindings[i];
            onProgress('STATUS', `Generating AI remediation for ${ruleGroup.id} (${i+1}/${rawFindings.length})...`);
            
            const qwenAbort = new AbortController();
            const qwenTimer = setTimeout(() => qwenAbort.abort(new Error(`Qwen timeout per-group (60s)`)), TIMEOUTS.qwen);
            
            // Link the overall abort to the per-group abort
            const onOverallAbort = () => qwenAbort.abort(abortController.signal.reason);
            abortController.signal.addEventListener('abort', onOverallAbort);

            try {
                const aiResponse = await runInference(ruleGroup, qwenAbort.signal);
                finalFindings.push({
                    deterministic: ruleGroup,
                    ai_guidance: aiResponse
                });
                onProgress('LLM_FINDING', { finding: finalFindings[finalFindings.length - 1] });
            } catch (err) {
                // If one LLM call fails, we append the failure but continue processing others
                finalFindings.push({
                    deterministic: ruleGroup,
                    ai_guidance: { error: err.message }
                });
                onProgress('LLM_FINDING', { finding: finalFindings[finalFindings.length - 1] });
            } finally {
                clearTimeout(qwenTimer);
                abortController.signal.removeEventListener('abort', onOverallAbort);
            }
        }
        
        clearTimeout(overallTimeout);
        return { status: 'DONE', findings: finalFindings };

    } catch (e) {
        clearTimeout(overallTimeout);
        throw e;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}
