import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/channels/@me');
    } catch (err) {
      setError(err.error || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="auth-wrapper">
      <form className="auth-box" onSubmit={handleSubmit}>
        <div className="auth-header">
          <h1>Welcome back</h1>
          <p>Sign in to continue to Stoat</p>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <label className="auth-label">
          <span>EMAIL <span className="required">*</span></span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="auth-label">
          <span>PASSWORD <span className="required">*</span></span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" className="auth-btn" disabled={loading}>
          {loading ? 'Logging in...' : 'Log In'}
        </button>
        <p className="auth-footer">
          Need an account? <Link to="/register">Register</Link>
        </p>
        <p className="auth-footer">
          App staff? <Link to="/admin">Open Admin Panel</Link>
        </p>
      </form>
    </div>
  );
}
