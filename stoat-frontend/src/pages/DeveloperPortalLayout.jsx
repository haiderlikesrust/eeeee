import { NavLink, Outlet, Link } from 'react-router-dom';
import './DeveloperPortalPage.css';
import './DeveloperPortalLayout.css';

export default function DeveloperPortalLayout() {
  return (
    <div className="dev-portal-page">
      <div className="dev-portal-shell">
        <header className="dev-portal-shell-header">
          <div>
            <h1>Developer Portal</h1>
            <p>Build bots and integrations with clear docs and dedicated tools.</p>
          </div>
          <div className="dev-portal-shell-links">
            <Link to="/developer/editor" className="dev-link-btn">No-Code Bot Builder</Link>
            <Link to="/bots" className="dev-link-btn">Bot Marketplace</Link>
            <Link to="/channels/@me" className="dev-link-btn">Back to App</Link>
          </div>
        </header>

        <nav className="dev-portal-tabs" aria-label="Developer portal sections">
          <NavLink
            to="/developers/docs/api"
            className={({ isActive }) => `dev-portal-tab ${isActive ? 'active' : ''}`}
          >
            Documentation
          </NavLink>
          <NavLink
            to="/developers/apps"
            className={({ isActive }) => `dev-portal-tab ${isActive ? 'active' : ''}`}
          >
            Applications
          </NavLink>
        </nav>

        <main className="dev-portal-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
