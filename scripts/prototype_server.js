import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { runPrototypePipeline } from './prototype_pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
app.use(cors());
app.use(express.json());

// ── Global mutex acquired at POST time ────────────────────────────────────────
let activeAudit = false;
const activeSandboxes = new Set();   // absolute paths only
const activeViteProcs = new Set();   // child process refs

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function cleanupAll() {
    console.log('[server] Shutting down — terminating sandbox Vite processes...');
    for (const proc of activeViteProcs) {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}
        try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
    }
    for (const dir of activeSandboxes) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
}
process.on('SIGINT',  () => { cleanupAll(); process.exit(0); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(0); });

// ── Find a free TCP port ──────────────────────────────────────────────────────
function findFreePort(start = 5174) {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(start, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
        srv.on('error', () => findFreePort(start + 1).then(resolve, reject));
    });
}

// ── Vite sandbox lifecycle ────────────────────────────────────────────────────
function spawnVite(sandboxDir, port) {
    const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
        cwd: sandboxDir,
        detached: true,   // process group so we can kill the whole group
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' }  // suppress colour codes in stdout parsing
    });
    activeViteProcs.add(proc);
    proc.on('exit', () => activeViteProcs.delete(proc));
    return proc;
}

async function startVite(sandboxDir) {
    const port = await findFreePort(5174);
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = spawnVite(sandboxDir, port);

    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, val) => {
            if (settled) return;
            settled = true;
            fn(val);
        };

        const timer = setTimeout(() => {
            settle(reject, new Error(`Vite did not report ready on port ${port} within 15s`));
        }, 15000);

        proc.stdout.on('data', (d) => {
            if (d.toString().includes('Local:') || d.toString().includes('ready in')) {
                clearTimeout(timer);
                settle(resolve, { baseUrl, proc });
            }
        });
        proc.on('exit', (code) => {
            clearTimeout(timer);
            settle(reject, new Error(`Vite exited unexpectedly (code=${code}) before becoming ready`));
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            settle(reject, err);
        });
    });
}

async function stopViteProc(proc) {
    if (!proc) return;
    return new Promise((resolve) => {
        const onExit = () => resolve();
        proc.once('exit', onExit);

        try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}

        const forceKill = setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
        }, 3000);

        proc.once('exit', () => { clearTimeout(forceKill); });

        // Final resolution safety
        setTimeout(() => {
            proc.removeListener('exit', onExit);
            resolve();
        }, 5000);
    });
}

// ── Session store ─────────────────────────────────────────────────────────────
const sessions = new Map(); // sessionId -> { caseId, streaming: bool }

// ── Routes ────────────────────────────────────────────────────────────────────

// POST acquires mutex immediately — concurrent POSTs get 429
app.post('/api/run-audit', (req, res) => {
    if (activeAudit) {
        return res.status(429).json({ error: 'An audit is already in progress. Try again when it finishes.' });
    }
    const { caseId } = req.body;
    const WHITELIST = ['case1', 'case2', 'case3'];
    if (!WHITELIST.includes(caseId)) {
        return res.status(400).json({ error: `Invalid caseId. Allowed: ${WHITELIST.join(', ')}` });
    }
    activeAudit = true;   // mutex acquired here
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { caseId, streaming: false });
    res.json({ sessionId });
});

// GET /api/stream — SSE stream that drives the audit
app.get('/api/stream', async (req, res) => {
    const { sessionId } = req.query;
    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found or already consumed' });
    }
    const session = sessions.get(sessionId);
    if (session.streaming) {
        return res.status(409).json({ error: 'Session already streaming' });
    }
    session.streaming = true;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    const emit = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
    };

    const sandboxId = crypto.randomUUID();
    const sandboxDir = path.join(os.tmpdir(), `.sandbox_${sandboxId}`);
    activeSandboxes.add(sandboxDir);

    let currentViteProc = null;

    const stopVite = async () => {
        await stopViteProc(currentViteProc);
        currentViteProc = null;
    };

    const restartVite = async () => {
        await stopVite();
        const { baseUrl, proc } = await startVite(sandboxDir);
        currentViteProc = proc;
        return baseUrl;
    };

    try {
        // ── Build sandbox ─────────────────────────────────────────────────────
        fs.mkdirSync(path.join(sandboxDir, 'src'), { recursive: true });

        // Copy canonical fixture
        fs.copyFileSync(
            path.join(rootDir, 'src/components/DemoCases.tsx'),
            path.join(sandboxDir, 'src/DemoCases.tsx')
        );

        // Sandbox main.tsx
        fs.writeFileSync(path.join(sandboxDir, 'src/main.tsx'),
`import React from 'react';
import ReactDOM from 'react-dom/client';
import { DemoCases } from './DemoCases';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode><DemoCases /></React.StrictMode>
);`);

        // index.html
        fs.writeFileSync(path.join(sandboxDir, 'index.html'),
`<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Sandbox</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>`);

        // vite.config.ts
        fs.writeFileSync(path.join(sandboxDir, 'vite.config.ts'),
`import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });`);

        // standalone tsconfig — does NOT extend root
        fs.writeFileSync(path.join(sandboxDir, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                target: "ES2020",
                useDefineForClassFields: true,
                lib: ["ES2020", "DOM", "DOM.Iterable"],
                module: "ESNext",
                skipLibCheck: true,
                moduleResolution: "bundler",
                allowImportingTsExtensions: true,
                resolveJsonModule: true,
                isolatedModules: true,
                noEmit: true,
                jsx: "react-jsx",
                strict: true,
                noUnusedLocals: false,
                noUnusedParameters: false,
                noFallthroughCasesInSwitch: true
            },
            include: ["src"]
        }, null, 2));

        // Symlink node_modules
        fs.symlinkSync(
            path.join(rootDir, 'node_modules'),
            path.join(sandboxDir, 'node_modules'),
            'dir'
        );

        // ── Start initial Vite ─────────────────────────────────────────────────
        let startResult;
        try {
            startResult = await startVite(sandboxDir);
        } catch (ve) {
            emit('ERROR', { message: `Vite failed to start: ${ve.message}` });
            return;
        }
        currentViteProc = startResult.proc;
        const initialBaseUrl = startResult.baseUrl;

        // ── Run pipeline ───────────────────────────────────────────────────────
        await runPrototypePipeline({
            baseUrl: initialBaseUrl,
            sandboxDir,
            fixturePath: path.join(sandboxDir, 'src/DemoCases.tsx'),
            caseId: session.caseId,
            emit,
            stopVite,
            restartVite
        });

    } catch (err) {
        emit('ERROR', { message: err.message, stack: err.stack?.slice(0, 500) });
    } finally {
        // Release mutex FIRST so the next audit can start while we clean up
        activeAudit = false;

        // ── Guaranteed cleanup ─────────────────────────────────────────────────
        await stopViteProc(currentViteProc).catch(() => {});
        currentViteProc = null;

        try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch (_) {}
        activeSandboxes.delete(sandboxDir);
        sessions.delete(sessionId);

        // Verify Vite is really gone
        if (activeViteProcs.size > 0) {
            console.warn(`[server] WARNING: ${activeViteProcs.size} Vite process(es) still registered after cleanup`);
        }

        res.end();
    }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`[server] Prototype API running at http://localhost:${PORT}`));
