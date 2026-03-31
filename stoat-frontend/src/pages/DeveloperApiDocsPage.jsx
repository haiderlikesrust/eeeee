import { getPresenceCurlSnippet, NODE_PRESENCE_SNIPPET } from './developer/constants';
import './DeveloperPortalPage.css';

export default function DeveloperApiDocsPage() {
  const curlSnippet = getPresenceCurlSnippet(typeof window !== 'undefined' ? window.location.origin : '');

  return (
    <div className="dev-docs-content">
      <h2>API Reference</h2>
      <p>
        The Opic developer API currently focuses on account presence updates and bot-related endpoints.
        Use your bearer token and JSON requests for all protected routes.
      </p>

      <h3>Authentication</h3>
      <p>
        Send <code>Authorization: Bearer ...</code> and <code>Content-Type: application/json</code> headers.
        Presence calls use your personal presence token from the Applications tab.
      </p>

      <h3>Presence endpoint</h3>
      <p>
        <code>PATCH /api/public/v1/presence</code> updates your activity and lease-based online state.
        Use <code>ttl_seconds</code> for lease duration and <code>heartbeat: true</code> to keep the lease alive.
      </p>
      <pre className="dev-code">{curlSnippet}</pre>

      <h3>Lease behavior</h3>
      <p>
        While your script sends updates before lease expiry, presence stays visible. If your process stops and heartbeats
        stop, activity auto-clears. You can also clear immediately with <code>{'{"activity":null}'}</code>.
      </p>
      <p>
        Optional presence modes are <code>Online</code>, <code>Idle</code>, <code>Busy</code>, and <code>Invisible</code>.
      </p>

      <h3>Node example</h3>
      <pre className="dev-code">{NODE_PRESENCE_SNIPPET}</pre>
    </div>
  );
}
