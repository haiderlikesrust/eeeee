import { Link } from 'react-router-dom';
import './DeveloperPortalPage.css';

export default function DeveloperBotsDocsPage() {
  return (
    <div className="dev-docs-content">
      <h2>Bots Guide</h2>
      <p>
        Build bots with slash commands, install them into owned servers, and keep behavior configurable from the
        Applications tab.
      </p>

      <h3>Bot lifecycle</h3>
      <ol className="dev-docs-list">
        <li>Create a bot in Applications.</li>
        <li>Set intents and visibility flags.</li>
        <li>Configure interactions URL and slash command JSON.</li>
        <li>Reveal/copy token, deploy your code, and install to server.</li>
      </ol>

      <h3>Interactions</h3>
      <p>
        When users run slash commands, Opic sends a signed POST body to your interactions endpoint over HTTPS.
        Respond quickly with JSON like <code>{'{"type":4,"data":{"content":"Hi"}}'}</code>.
      </p>
      <p>
        Headers include <code>X-Stoat-Timestamp</code> and <code>X-Stoat-Signature</code> where the signature is
        HMAC-SHA256 of <code>timestamp + "." + rawBody</code> using your bot token.
      </p>

      <h3>Command naming rules</h3>
      <ul className="dev-docs-list">
        <li>Lowercase characters only: <code>a-z 0-9 _ -</code></li>
        <li>Must be unique per server among bots</li>
        <li>Cannot match built-ins: <code>help</code>, <code>ping</code>, <code>shrug</code>, <code>tableflip</code></li>
      </ul>

      <h3>SDK quick test</h3>
      <p>Run this from your <code>stoat-bot-sdk</code> directory after copying a bot token:</p>
      <pre className="dev-code">BOT_TOKEN=your_token_here node examples/ping-bot.js</pre>
      <p>
        You can also use the <Link to="/developer/editor">No-Code Bot Builder</Link> to generate starter bot logic.
      </p>
    </div>
  );
}
