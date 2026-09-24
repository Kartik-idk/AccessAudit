import http from 'http';
import net from 'net';
import dns from 'dns';
import { URL } from 'url';
import ipaddr from 'ipaddr.js';

// --- IP Safety Validation ---
async function isSafeIp(ipStr) {
    try {
        const addr = ipaddr.parse(ipStr);
        const range = addr.range();
        const blockedRanges = [
            'unspecified', 'broadcast', 'multicast', 'linkLocal', 'loopback', 'private', 
            'carrierGradeNat', 'reserved', 'ipv4Mapped', 'rfc6145', 'rfc6052', '6to4', 'teredo'
        ];
        if (blockedRanges.includes(range)) return false;
        
        if (addr.kind() === 'ipv4' && ipStr.startsWith('169.254.')) return false;
        if (addr.kind() === 'ipv4' && ipStr.startsWith('127.')) return false;
        if (addr.kind() === 'ipv6' && ipStr === '::1') return false;
        
        return true;
    } catch (e) {
        return false;
    }
}

export async function resolveAndCheckSafety(hostname) {
    try {
        if (ipaddr.isValid(hostname)) {
            if (await isSafeIp(hostname)) return hostname;
            else throw new Error('Blocked IP');
        }

        const records = await dns.promises.lookup(hostname, { all: true });
        if (records.length === 0) throw new Error('No DNS records');
        
        let validatedIp = null;
        for (const record of records) {
            if (!(await isSafeIp(record.address))) {
                throw new Error(`Hostname ${hostname} resolved to a blocked IP: ${record.address}`);
            }
            if (!validatedIp) {
                validatedIp = record.address;
            }
        }
        return validatedIp;
    } catch (e) {
        throw e;
    }
}

// --- Egress Proxy Server ---
export class SsrfProxy {
    constructor() {
        this.server = null;
        this.port = 0;
    }

    start(port = 0) {
        return new Promise((resolve, reject) => {
            this.server = http.createServer();
            
            // Handle normal HTTP requests
            this.server.on('request', async (req, res) => {
                try {
                    const parsedUrl = new URL(req.url);
                    if (parsedUrl.protocol !== 'http:') {
                        res.writeHead(400);
                        res.end('Only HTTP proxying supported here');
                        return;
                    }

                    const validatedIp = await resolveAndCheckSafety(parsedUrl.hostname);
                    
                    const options = {
                        hostname: validatedIp, // EXACT VALIDATED IP
                        port: parsedUrl.port || 80,
                        path: parsedUrl.pathname + parsedUrl.search,
                        method: req.method,
                        headers: req.headers
                    };

                    const proxyReq = http.request(options, (proxyRes) => {
                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        proxyRes.pipe(res, { end: true });
                    });

                    proxyReq.on('error', (err) => {
                        if (!res.headersSent) res.writeHead(502);
                        res.end('Proxy Error');
                    });

                    req.pipe(proxyReq, { end: true });
                } catch (e) {
                    if (!res.headersSent) res.writeHead(403);
                    res.end('Blocked by SSRF Egress Proxy');
                }
            });

            // Handle HTTPS CONNECT requests
            this.server.on('connect', async (req, clientSocket, head) => {
                try {
                    // Extract hostname and port from CONNECT string (e.g. example.com:443)
                    const [hostname, portStr] = req.url.split(':');
                    const port = portStr ? parseInt(portStr) : 443;
                    
                    const validatedIp = await resolveAndCheckSafety(hostname);

                    const serverSocket = net.connect(port, validatedIp, () => {
                        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                        serverSocket.write(head);
                        serverSocket.pipe(clientSocket);
                        clientSocket.pipe(serverSocket);
                    });

                    serverSocket.on('error', (err) => {
                        clientSocket.end();
                    });

                    clientSocket.on('error', (err) => {
                        serverSocket.end();
                    });
                } catch (e) {
                    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    clientSocket.end();
                }
            });

            this.server.on('error', (err) => {
                reject(err);
            });

            this.server.listen(port, '127.0.0.1', () => {
                this.port = this.server.address().port;
                resolve(this.port);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}
