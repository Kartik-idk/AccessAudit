import React, { useState } from 'react';

type Finding = {
  id: string;
  description: string;
  impact: string;
  type: string; // 'violation' | 'incomplete'
  criterion: string;
  totalNodes: number;
  snippets: string[];
};

type AIGuidance = {
  problem?: string;
  why_it_matters?: string;
  remediation_strategy?: string;
  observed_dom?: string;
  manual_review?: boolean;
  manual_review_reason?: string;
  error?: string;
};

type StreamEvent = { type: string; payload: any };

const WCAG_CARDS = [
  '1.1.1 Non-text Content',
  '1.3.1 Info and Relationships',
  '1.4.3 Contrast (Minimum)',
  '2.4.4 Link Purpose (In Context)',
  '4.1.2 Name, Role, Value'
];

export default function RealAuditUI() {
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('IDLE');
  const [pageInfo, setPageInfo] = useState<{ url: string; title: string } | null>(null);
  const [findings, setFindings] = useState<{ deterministic: Finding; ai_guidance: AIGuidance }[]>([]);
  const [axeStats, setAxeStats] = useState<{ totalFound: number; violations: number; incomplete: number } | null>(null);

  const startScan = async () => {
    if (!url) return;
    setRunning(true);
    setStatus('Initializing scan...');
    setFindings([]);
    setPageInfo(null);
    setAxeStats(null);

    try {
      const res = await fetch('http://localhost:3001/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setStatus(`ERROR: ${err.error || res.statusText}`);
        setRunning(false);
        return;
      }

      const { sessionId } = await res.json();
      const es = new EventSource(`http://localhost:3001/api/scan-stream?sessionId=${sessionId}`);

      es.onmessage = (e) => {
        const ev: StreamEvent = JSON.parse(e.data);

        if (ev.type === 'STATUS') {
          setStatus(ev.payload);
        } else if (ev.type === 'PAGE_INFO') {
          setPageInfo(ev.payload);
        } else if (ev.type === 'AXE_RESULTS') {
          setAxeStats(ev.payload);
        } else if (ev.type === 'LLM_FINDING') {
          setFindings(prev => [...prev, ev.payload.finding]);
        } else if (ev.type === 'DONE') {
          setStatus('Audit Complete');
          setRunning(false);
          es.close();
        } else if (ev.type === 'DONE_CLEAN') {
          setStatus('Audit Complete: No violations found for the 5 selected criteria.');
          setRunning(false);
          es.close();
        } else if (ev.type === 'ERROR') {
          setStatus(`ERROR: ${ev.payload.message}`);
          setRunning(false);
          es.close();
        }
      };

      es.onerror = () => {
        setStatus('ERROR: SSE stream disconnected unexpectedly.');
        setRunning(false);
        es.close();
      };
    } catch (e: any) {
      setStatus(`ERROR: ${e.message}`);
      setRunning(false);
    }
  };

  const findingsByCriterion = (crit: string) => findings.filter(f => f.deterministic.criterion === crit);

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ borderBottom: '2px solid #333', paddingBottom: 20, marginBottom: 30 }}>
        <h1 style={{ margin: 0 }}>AccessAudit</h1>
        <h2 style={{ margin: '5px 0 0 0', color: '#666', fontWeight: 'normal' }}>WCAG 2.2 Accessibility Audit</h2>
      </header>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input 
          type="url" 
          value={url} 
          onChange={(e) => setUrl(e.target.value)} 
          placeholder="https://example.com"
          disabled={running}
          style={{ flex: 1, padding: 12, fontSize: '1.1em', borderRadius: 4, border: '1px solid #ccc' }}
        />
        <button 
          onClick={startScan} 
          disabled={running || !url}
          style={{ padding: '0 24px', fontSize: '1.1em', background: '#0056b3', color: '#fff', border: 'none', borderRadius: 4, cursor: running || !url ? 'not-allowed' : 'pointer', opacity: running ? 0.7 : 1 }}
        >
          {running ? 'Scanning...' : 'Scan'}
        </button>
      </div>

      <div style={{ background: '#f5f5f5', padding: 20, borderRadius: 4, marginBottom: 30 }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Scan Status: {status}</h3>
        {pageInfo && (
          <div>
            <div><strong>URL:</strong> <a href={pageInfo.url} target="_blank" rel="noreferrer">{pageInfo.url}</a></div>
            <div><strong>Title:</strong> {pageInfo.title}</div>
          </div>
        )}
        {axeStats && (
          <div style={{ marginTop: 10 }}>
            <strong>Axe Findings:</strong> {axeStats.violations} violations, {axeStats.incomplete} incomplete (requires manual review)
          </div>
        )}
      </div>

      <div>
        {WCAG_CARDS.map(criterion => {
          const critFindings = findingsByCriterion(criterion);
          return (
            <div key={criterion} style={{ border: '1px solid #ddd', borderRadius: 8, marginBottom: 30, overflow: 'hidden' }}>
              <div style={{ background: '#333', color: '#fff', padding: '15px 20px' }}>
                <h2 style={{ margin: 0, fontSize: '1.2em' }}>{criterion}</h2>
                <div style={{ fontSize: '0.9em', opacity: 0.8, marginTop: 4 }}>
                  {critFindings.length} findings
                </div>
              </div>

              <div style={{ padding: 20 }}>
                {critFindings.length === 0 ? (
                  <p style={{ color: '#888', fontStyle: 'italic' }}>No issues found for this criterion.</p>
                ) : (
                  critFindings.map((f, i) => (
                    <div key={i} style={{ borderBottom: i === critFindings.length - 1 ? 'none' : '1px solid #eee', paddingBottom: 20, marginBottom: 20 }}>
                      
                      {/* Axe Deterministic Block */}
                      <div style={{ background: '#fff3cd', borderLeft: '4px solid #ffecb5', padding: '15px', marginBottom: '15px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.85em', color: '#856404', letterSpacing: 1, marginBottom: 10 }}>DETECTED BY AXE</div>
                        <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
                          <div><strong>Rule:</strong> {f.deterministic.id}</div>
                          <div><strong>Impact:</strong> {f.deterministic.impact || 'N/A'}</div>
                          <div>
                            <strong>Status:</strong> {f.deterministic.type === 'incomplete' 
                              ? <span style={{ color: '#d39e00', fontWeight: 'bold' }}>MANUAL REVIEW REQUIRED</span>
                              : <span style={{ color: '#dc3545', fontWeight: 'bold' }}>VIOLATION</span>}
                          </div>
                        </div>
                        <p style={{ margin: '0 0 10px 0' }}>{f.deterministic.description}</p>
                        
                        <div><strong>Affected HTML ({f.deterministic.totalNodes} nodes):</strong></div>
                        <pre style={{ background: '#fff', padding: 10, overflowX: 'auto', fontSize: '0.9em', border: '1px solid #ffeeba' }}>
                          {f.deterministic.snippets.join('\n\n')}
                        </pre>
                      </div>

                      {/* AI Remediation Block */}
                      <div style={{ background: '#e2e3e5', borderLeft: '4px solid #d6d8db', padding: '15px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.85em', color: '#383d41', letterSpacing: 1, marginBottom: 10 }}>AI REMEDIATION GUIDANCE</div>
                        
                        {f.ai_guidance.error ? (
                          <div style={{ color: 'red' }}><strong>LLM Error:</strong> {f.ai_guidance.error}</div>
                        ) : (
                          <>
                            <p style={{ margin: '0 0 10px 0' }}><strong>Problem:</strong> {f.ai_guidance.problem}</p>
                            <p style={{ margin: '0 0 10px 0' }}><strong>Why it matters:</strong> {f.ai_guidance.why_it_matters}</p>
                            
                            {f.ai_guidance.manual_review && (
                              <div style={{ background: '#fff', padding: 10, border: '1px solid #ccc', marginBottom: 10 }}>
                                <strong>⚠️ Manual Review Required:</strong> {f.ai_guidance.manual_review_reason}
                              </div>
                            )}

                            <div style={{ marginTop: 15 }}><strong>RECOMMENDED CHANGE (NOT APPLIED):</strong></div>
                            <p style={{ margin: '5px 0 10px 0' }}>{f.ai_guidance.remediation_strategy}</p>
                            
                            {f.ai_guidance.observed_dom && (
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: '0.85em', fontWeight: 'bold', color: '#dc3545' }}>OBSERVED RENDERED DOM</div>
                                <pre style={{ background: '#fff', padding: 10, overflowX: 'auto', fontSize: '0.85em', border: '1px solid #f5c6cb' }}>{f.ai_guidance.observed_dom}</pre>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
