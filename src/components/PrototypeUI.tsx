import React, { useState, useRef, useEffect } from 'react';

type StreamEvent = { type: string; payload: any };

// ── Helpers ───────────────────────────────────────────────────────────────────

const TERMINAL = new Set(['DONE', 'SAFE_REJECTED', 'FAILED', 'ERROR']);

const EVENT_META: Record<string, { label: string; icon: string; color: string }> = {
  DETECTED:     { label: 'Violation Detected',      icon: '🔍', color: '#b45309' },
  PROVENANCE:   { label: 'Source Context Located',  icon: '📍', color: '#1d4ed8' },
  PROPOSAL:     { label: 'Model Proposal',           icon: '🤖', color: '#7c3aed' },
  GATEKEEPER:   { label: 'Gatekeeper Decision',     icon: '🛡',  color: '#0f766e' },
  BUILD:        { label: 'TypeScript Build',         icon: '🔨', color: '#374151' },
  PATCH:        { label: 'Patch Applied',            icon: '🩹', color: '#065f46' },
  VERIFY:       { label: 'Axe Verification',         icon: '✅', color: '#14532d' },
  DONE:         { label: 'Audit Complete',           icon: '🎉', color: '#14532d' },
  SAFE_REJECTED:{ label: 'Safely Rejected',          icon: '🚫', color: '#92400e' },
  FAILED:       { label: 'Verification Failed',      icon: '❌', color: '#991b1b' },
  ERROR:        { label: 'Error',                    icon: '⚠️', color: '#991b1b' },
};

function EventCard({ ev }: { ev: StreamEvent }) {
  const meta = EVENT_META[ev.type] ?? { label: ev.type, icon: '•', color: '#374151' };
  const p = ev.payload;

  let body: React.ReactNode = null;

  if (ev.type === 'DETECTED') {
    if (p.rule) body = <p><b>Rule:</b> <code>{p.rule}</code> &nbsp;|&nbsp; <b>Target:</b> <code>{(p.targets ?? []).join(', ')}</code></p>;
    else if (p.baselineTargetViolations) body = (
      <p>
        <b>Baseline violation confirmed:</b> <code>{p.baselineTargetViolations.join(', ')}</code>
        &nbsp;|&nbsp; <b>Global Axe issues at baseline:</b> {p.globalCount}
      </p>
    );
  } else if (ev.type === 'PROVENANCE') {
    body = (
      <>
        <p><b>Nodes found in source:</b> {(p.nodesFound ?? []).join(', ')}</p>
        <pre style={preStyle}>{p.context}</pre>
      </>
    );
  } else if (ev.type === 'PROPOSAL') {
    body = (
      <>
        <p><b>Rationale:</b> {p.rationale}</p>
        <p><b>Action:</b> <code>{p.action}</code></p>
        {Array.isArray(p.operations) && p.operations.map((op: any, i: number) => (
          <p key={i} style={{ marginLeft: 12 }}>
            ↳ <code>{op.target}</code>: <b>{op.operation}</b> <code>{op.attribute ?? op.replacement_tag}</code>
            {op.value ? <> = <code>"{op.value}"</code></> : null}
          </p>
        ))}
      </>
    );
  } else if (ev.type === 'GATEKEEPER') {
    const accepted = p.status === 'ACCEPTED';
    body = (
      <p style={{ color: accepted ? '#065f46' : '#991b1b', fontWeight: 700 }}>
        {accepted ? '✅ Accepted — patch is semantically valid' : `❌ Rejected — ${p.reason}`}
      </p>
    );
  } else if (ev.type === 'BUILD') {
    const ok = p.status === 'SUCCESS';
    body = <p style={{ color: ok ? '#065f46' : '#991b1b', fontWeight: 700 }}>{ok ? '✅ TypeScript compiled without errors' : `❌ Build failed: ${p.stderr ?? ''}`}</p>;
  } else if (ev.type === 'PATCH') {
    body = <p>Patch applied to sandbox fixture. Evaluator IDs injected: <code>{(p.trackingInjected ?? []).join(', ')}</code></p>;
  } else if (ev.type === 'VERIFY') {
    body = (
      <>
        <p><b>Target resolved:</b> {p.targetResolved ? '✅ Yes' : '❌ No'}</p>
        <p><b>New regressions:</b> {p.regressions?.length === 0 ? '✅ None' : `❌ ${p.regressions?.length} new violation(s)`}</p>
        <p style={{ fontSize: '0.85em', color: '#6b7280' }}>
          Global Axe count: {p.globalBaselineCount} → {p.globalPostCount}
        </p>
      </>
    );
  } else if (ev.type === 'DONE') {
    body = <p style={{ fontWeight: 700, fontSize: '1.05em' }}>{p.message}</p>;
  } else if (ev.type === 'SAFE_REJECTED') {
    body = <p><b>Reason:</b> {p.reason}</p>;
  } else if (ev.type === 'FAILED') {
    body = <p><b>Reason:</b> {p.message}</p>;
  } else if (ev.type === 'ERROR') {
    body = (
      <>
        <p style={{ color: '#991b1b' }}><b>{p.message}</b></p>
        {p.raw && <pre style={{ ...preStyle, color: '#991b1b' }}>{p.raw}</pre>}
      </>
    );
  } else {
    body = <pre style={preStyle}>{JSON.stringify(p, null, 2)}</pre>;
  }

  return (
    <div style={{
      marginBottom: 12, padding: '12px 16px',
      background: '#fff', border: `1px solid #e5e7eb`,
      borderLeft: `4px solid ${meta.color}`,
      borderRadius: 6
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: '1.1em' }}>{meta.icon}</span>
        <strong style={{ color: meta.color, fontSize: '0.9em', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {meta.label}
        </strong>
      </div>
      <div style={{ fontSize: '0.92em', color: '#374151', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

// ── Main UI ───────────────────────────────────────────────────────────────────

const CASES = [
  { id: 'case1', label: 'Case 1', desc: 'Missing image alt text', rule: 'image-alt' },
  { id: 'case2', label: 'Case 2', desc: 'Missing button accessible name', rule: 'button-name' },
  { id: 'case3', label: 'Case 3', desc: 'Invalid ARIA role', rule: 'aria-roles' },
];

export default function PrototypeUI() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<'IDLE' | 'RUNNING' | 'DONE' | 'SAFE_REJECTED' | 'FAILED' | 'ERROR'>('IDLE');
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll timeline to bottom on new events
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [events]);

  const runAudit = async (caseId: string) => {
    if (running) return;
    setRunning(true);
    setEvents([]);
    setStatus('RUNNING');
    setActiveCase(caseId);

    try {
      const res = await fetch('http://localhost:3001/api/run-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setEvents([{ type: 'ERROR', payload: { message: err.error ?? `HTTP ${res.status}` } }]);
        setStatus('ERROR');
        setRunning(false);
        return;
      }

      const { sessionId } = await res.json();
      const es = new EventSource(`http://localhost:3001/api/stream?sessionId=${sessionId}`);

      es.onmessage = (e) => {
        const ev: StreamEvent = JSON.parse(e.data);
        setEvents(prev => [...prev, ev]);

        if (TERMINAL.has(ev.type)) {
          setStatus(ev.type as any);
          setRunning(false);
          es.close();
        }
      };

      es.onerror = () => {
        setEvents(prev => [...prev, { type: 'ERROR', payload: { message: 'SSE stream disconnected unexpectedly.' } }]);
        setStatus('ERROR');
        setRunning(false);
        es.close();
      };
    } catch (e: any) {
      setEvents([{ type: 'ERROR', payload: { message: e.message } }]);
      setStatus('ERROR');
      setRunning(false);
    }
  };

  const statusBadge = {
    IDLE:          { bg: '#f3f4f6', color: '#6b7280', text: 'Idle — select a case to begin' },
    RUNNING:       { bg: '#eff6ff', color: '#1d4ed8', text: '⏳ Running audit…' },
    DONE:          { bg: '#f0fdf4', color: '#14532d', text: '🎉 Done — accessibility issue resolved' },
    SAFE_REJECTED: { bg: '#fffbeb', color: '#92400e', text: '🚫 Safely rejected by gatekeeper' },
    FAILED:        { bg: '#fef2f2', color: '#991b1b', text: '❌ Verification failed' },
    ERROR:         { bg: '#fef2f2', color: '#991b1b', text: '⚠️ Error — see timeline' },
  }[status] ?? { bg: '#f3f4f6', color: '#374151', text: status };

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '18px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: '1.4em' }}>♿</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.15em', letterSpacing: '-0.01em' }}>AccessAudit Prototype</div>
          <div style={{ fontSize: '0.8em', color: '#94a3b8' }}>Qwen-powered automated accessibility remediation</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 68px)' }}>
        {/* Left panel */}
        <div style={{ width: 300, background: '#fff', borderRight: '1px solid #e5e7eb', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280' }}>Demonstration Cases</h2>

          {CASES.map(c => {
            const isActive = activeCase === c.id;
            return (
              <button
                key={c.id}
                id={`btn-${c.id}`}
                disabled={running}
                onClick={() => runAudit(c.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 14px', border: `1px solid ${isActive ? '#1d4ed8' : '#e5e7eb'}`,
                  borderRadius: 8, background: isActive ? '#eff6ff' : '#fff',
                  cursor: running ? 'not-allowed' : 'pointer',
                  opacity: running ? 0.6 : 1,
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9em', color: isActive ? '#1d4ed8' : '#1e293b' }}>{c.label}</div>
                <div style={{ fontSize: '0.8em', color: '#6b7280', marginTop: 2 }}>{c.desc}</div>
                <div style={{ fontSize: '0.75em', color: '#9ca3af', marginTop: 4 }}>Rule: <code>{c.rule}</code></div>
              </button>
            );
          })}

          <div style={{ marginTop: 'auto' }}>
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: statusBadge.bg, color: statusBadge.color,
              fontSize: '0.85em', fontWeight: 500, lineHeight: 1.4
            }}>
              {statusBadge.text}
            </div>
          </div>
        </div>

        {/* Timeline panel */}
        <div ref={timelineRef} style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#f9fafb' }}>
          {events.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: '0.95em', marginTop: 40, textAlign: 'center' }}>
              <div style={{ fontSize: '2em', marginBottom: 12 }}>♿</div>
              <div>Select a case from the left panel to begin an accessibility audit.</div>
              <div style={{ marginTop: 8, fontSize: '0.85em' }}>
                Each audit runs in an isolated sandbox — the main application is never modified.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.8em', color: '#6b7280', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Execution Timeline — {activeCase}
              </div>
              {events.map((ev, i) => <EventCard key={i} ev={ev} />)}
              {running && (
                <div style={{ padding: '12px 16px', background: '#eff6ff', borderRadius: 6, color: '#1d4ed8', fontSize: '0.9em', animation: 'pulse 1.5s infinite' }}>
                  ⏳ Processing…
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4,
  padding: '8px 12px', fontSize: '0.82em', overflowX: 'auto',
  whiteSpace: 'pre-wrap', margin: '8px 0 0 0', lineHeight: 1.5
};
