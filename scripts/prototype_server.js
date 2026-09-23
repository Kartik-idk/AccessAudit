import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { runPrototypePipeline } from './prototype_pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
app.use(cors());
app.use(express.json());

let activeAudit = false;
const activeSandboxes = new Set();
const activeProcesses = new Set();

const sessions = new Map();

function cleanupAll() {
    console.log("Cleaning up active processes and sandboxes...");
    for (const proc of activeProcesses) {
        try {
            process.kill(-proc.pid);
        } catch(e) {}
    }
    for (const dir of activeSandboxes) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch(e) {}
    }
}

process.on('SIGINT', () => { cleanupAll(); process.exit(); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(); });

app.post('/api/run-audit', (req, res) => {
    if (activeAudit) {
        return res.status(429).json({ error: 'An audit is already running.' });
    }
    const { caseId } = req.body;
    if (!['case1', 'case2', 'case3'].includes(caseId)) {
        return res.status(400).json({ error: 'Invalid caseId' });
    }

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { caseId, started: false, events: [] });
    res.json({ sessionId });
});

app.get('/api/stream', async (req, res) => {
    const { sessionId } = req.query;
    if (!sessions.has(sessionId)) {
        return res.status(404).send('Session not found');
    }
    const session = sessions.get(sessionId);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const emit = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
    };

    if (session.started) {
        emit('ERROR', { message: 'Session already started' });
        return res.end();
    }
    
    session.started = true;
    activeAudit = true;

    const sandboxId = crypto.randomUUID();
    const sandboxDir = path.join(rootDir, `.sandbox_${sandboxId}`);
    let viteProc = null;

    const startVite = async () => {
        return new Promise((resolve) => {
            // Find open port logic simplified: just use a static port for sandbox since mutex guarantees 1 at a time
            const port = 5174; 
            viteProc = spawn('npx', ['vite', '--port', port.toString(), '--strictPort'], { cwd: sandboxDir, detached: true });
            activeProcesses.add(viteProc);
            
            viteProc.stdout.on('data', (d) => {
                if (d.toString().includes('Local:')) resolve(`http://localhost:${port}`);
            });
            // Fallback timeout
            setTimeout(() => resolve(`http://localhost:${port}`), 3000);
        });
    };

    const stopVite = async () => {
        if (viteProc) {
            try {
                process.kill(-viteProc.pid);
            } catch(e) {}
            activeProcesses.delete(viteProc);
            viteProc = null;
            await new Promise(r => setTimeout(r, 1000));
        }
    };

    try {
        // Create Sandbox
        fs.mkdirSync(sandboxDir, { recursive: true });
        activeSandboxes.add(sandboxDir);

        // Copy fixture
        const srcDir = path.join(sandboxDir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.copyFileSync(path.join(rootDir, 'src/components/DemoCases.tsx'), path.join(srcDir, 'DemoCases.tsx'));

        // Create main.tsx
        fs.writeFileSync(path.join(srcDir, 'main.tsx'), `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { DemoCases } from './DemoCases';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DemoCases />
  </React.StrictMode>
);
        `);

        // Create index.html
        fs.writeFileSync(path.join(sandboxDir, 'index.html'), `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sandbox</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
        `);

        // Create vite.config.ts
        fs.writeFileSync(path.join(sandboxDir, 'vite.config.ts'), `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
        `);

        // Create tsconfig.json
        fs.writeFileSync(path.join(sandboxDir, 'tsconfig.json'), `
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
        `);

        // Symlink node_modules
        fs.symlinkSync(path.join(rootDir, 'node_modules'), path.join(sandboxDir, 'node_modules'), 'dir');

        const baseUrl = await startVite();

        await runPrototypePipeline({
            baseUrl,
            sandboxDir,
            fixturePath: path.join(srcDir, 'DemoCases.tsx'),
            caseId: session.caseId,
            emit,
            stopVite,
            restartVite: startVite
        });

    } catch(err) {
        emit('ERROR', { message: err.message, stack: err.stack });
    } finally {
        await stopVite();
        try {
            fs.rmSync(sandboxDir, { recursive: true, force: true });
        } catch(e) {}
        activeSandboxes.delete(sandboxDir);
        activeAudit = false;
        sessions.delete(sessionId);
        res.end();
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Prototype server running on http://localhost:${PORT}`);
});
