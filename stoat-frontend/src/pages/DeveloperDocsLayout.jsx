import { NavLink, Outlet } from 'react-router-dom';
import './DeveloperPortalPage.css';
import './DeveloperPortalLayout.css';

export default function DeveloperDocsLayout() {
  return (
    <div className="dev-docs-layout">
      <aside className="dev-docs-sidebar">
        <div className="dev-docs-sidebar-title">Docs</div>
        <div className="dev-docs-sidebar-group">Reference</div>
        <NavLink
          to="/developers/docs/api"
          className={({ isActive }) => `dev-docs-nav-link ${isActive ? 'active' : ''}`}
        >
          API
        </NavLink>
        <NavLink
          to="/developers/docs/bots"
          className={({ isActive }) => `dev-docs-nav-link ${isActive ? 'active' : ''}`}
        >
          Bots
        </NavLink>
      </aside>

      <article className="dev-docs-article">
        <Outlet />
      </article>
    </div>
  );
}
