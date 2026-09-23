import React, { useState, useEffect } from 'react';

type StreamEvent = {
  type: string;
  payload: any;
};

export default function PrototypeUI() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<string>('IDLE');

  const runAudit = async (caseId: string) => {
    setRunning(true);
    setEvents([]);
    setStatus(`STARTING ${caseId}...`);

    try {
      const res = await fetch(`http://localhost:3001/api/run-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId })
      });

      if (!res.ok) {
        setStatus(`ERROR: ${res.status} ${res.statusText}`);
        setRunning(false);
        return;
      }

      const { sessionId } = await res.json();
      
      const eventSource = new EventSource(`http://localhost:3001/api/stream?sessionId=${sessionId}`);
      
      eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev, data]);
        setStatus(data.type);

        if (['DONE', 'ERROR'].includes(data.type)) {
          eventSource.close();
          setRunning(false);
        }
      };

      eventSource.onerror = (e) => {
        console.error("SSE Error", e);
        eventSource.close();
        setStatus('ERROR_STREAM_DISCONNECTED');
        setRunning(false);
      };
    } catch (e: any) {
      setStatus(`ERROR: ${e.message}`);
      setRunning(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>AccessAudit Prototype</h1>
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ flex: 1, border: '1px solid #ddd', padding: '20px' }}>
          <h2>Target Demonstration Cases</h2>
          <button disabled={running} onClick={() => runAudit('case1')} style={btnStyle}>Run Case 1 (Missing Alt)</button>
          <button disabled={running} onClick={() => runAudit('case2')} style={btnStyle}>Run Case 2 (Missing Button Name)</button>
          <button disabled={running} onClick={() => runAudit('case3')} style={btnStyle}>Run Case 3 (Invalid ARIA Role)</button>
          
          <hr />
          <h3>Current Status: <strong>{status}</strong></h3>
        </div>
        
        <div style={{ flex: 2, border: '1px solid #ddd', padding: '20px', background: '#f9f9f9', height: '600px', overflowY: 'auto' }}>
          <h2>Execution Timeline</h2>
          {events.map((ev, i) => (
            <div key={i} style={{ marginBottom: '15px', padding: '10px', background: '#fff', border: '1px solid #eee' }}>
              <strong style={{ color: '#0066cc' }}>[{ev.type}]</strong>
              <pre style={{ margin: '10px 0 0 0', whiteSpace: 'pre-wrap', fontSize: '0.9em' }}>
                {typeof ev.payload === 'object' ? JSON.stringify(ev.payload, null, 2) : ev.payload}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  display: 'block',
  width: '100%',
  padding: '10px',
  marginBottom: '10px',
  background: '#333',
  color: '#fff',
  border: 'none',
  cursor: 'pointer'
};
