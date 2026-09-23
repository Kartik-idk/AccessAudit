import http from 'http';

async function runAudit(caseId) {
    console.log(`\n=== Running ${caseId} ===`);
    const sessionId = await new Promise((resolve, reject) => {
        const req = http.request('http://localhost:3001/api/run-audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}: ${data}`));
                resolve(JSON.parse(data).sessionId);
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify({ caseId }));
        req.end();
    });

    console.log(`Session started: ${sessionId}`);

    return new Promise((resolve, reject) => {
        http.get(`http://localhost:3001/api/stream?sessionId=${sessionId}`, (res) => {
            res.on('data', (chunk) => {
                const text = chunk.toString();
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.substring(6));
                        console.log(`[${data.type}]`, data.payload?.message || data.payload?.status || '');
                    }
                }
            });
            res.on('error', reject);
            res.on('end', () => resolve('ENDED'));
        }).on('error', reject);
    });
}

async function run() {
    try {
        await runAudit('case1');
        await runAudit('case2');
        await runAudit('case3');
        await runAudit('case1');
        console.log("\nALL CASES COMPLETED");
    } catch (e) {
        console.error(e);
    }
}
run();
