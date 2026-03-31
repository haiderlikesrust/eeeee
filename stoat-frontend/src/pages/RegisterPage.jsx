import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(email, password, username || undefined);
      try { localStorage.setItem('opic.onboarding.justRegistered', '1'); } catch {}
      navigate('/channels/@me');
    } catch (err) {
      setError(err.error || 'Registration failed');
    }
    setLoading(false);
  };

  return (
    <div className="auth-wrapper">
      <form className="auth-box" onSubmit={handleSubmit}>
        <div className="auth-header">
          <h1>Join Opic</h1>
          <p>Create your account to get started</p>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <label className="auth-label">
          <span>EMAIL <span className="required">*</span></span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="auth-label">
          <span>DISPLAY NAME</span>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Optional" />
        </label>
        <label className="auth-label">
          <span>PASSWORD <span className="required">*</span></span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        <button type="submit" className="auth-btn" disabled={loading}>
          {loading ? 'Creating...' : 'Continue'}
        </button>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
        <p className="auth-footer">
          <Link to="/changelog">Changelog</Link>
        </p>
      </form>
    </div>
  );
}
