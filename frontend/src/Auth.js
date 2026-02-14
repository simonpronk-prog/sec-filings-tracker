import React, { useState } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'https://sec-filings-tracker-production.up.railway.app';

const styles = {
  screen: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  card: { background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', width: '100%', maxWidth: '420px' },
  input: { width: '100%', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem', boxSizing: 'border-box', marginBottom: '1rem' },
  code: { width: '100%', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1.2rem', textAlign: 'center', letterSpacing: '8px', fontFamily: 'monospace', boxSizing: 'border-box', marginBottom: '1rem' },
  btnPrimary: { width: '100%', padding: '0.75rem', background: '#667eea', color: 'white', border: 'none', borderRadius: '4px', fontSize: '1rem', cursor: 'pointer', marginBottom: '1rem' },
  btnOutline: { width: '100%', padding: '0.75rem', background: 'transparent', color: '#667eea', border: '1px solid #667eea', borderRadius: '4px', fontSize: '1rem', cursor: 'pointer' },
  error: { color: 'red', marginBottom: '1rem', fontSize: '0.9rem' },
  success: { color: '#28a745', marginBottom: '1rem', fontSize: '0.9rem' },
  title: { textAlign: 'center', marginBottom: '0.5rem', color: '#333' },
  subtitle: { color: '#666', textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.9rem' },
};

export default function Auth({ onLogin }) {
  const [view, setView] = useState('login'); // login, register, reset, totp-setup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 2FA
  const [needs2FA, setNeeds2FA] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  // TOTP setup after register
  const [totpSetup, setTotpSetup] = useState(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmToken, setConfirmToken] = useState('');
  // Reset
  const [resetEmail, setResetEmail] = useState('');
  const [resetTotp, setResetTotp] = useState('');
  const [resetPass, setResetPass] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const body = { email, password };
      if (needs2FA) body.totpCode = totpCode;
      const r = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await r.json();
      if (r.ok) {
        if (d.requires2FA) { setNeeds2FA(true); setLoading(false); return; }
        localStorage.setItem('sec_token', d.token);
        onLogin();
      } else { setError(d.error || 'Login failed'); }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const r = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const d = await r.json();
      if (r.ok) {
        if (d.totp && d.totp.setupRequired) {
          setConfirmToken(d.token);
          setTotpSetup(d.totp);
          setView('totp-setup');
        } else {
          localStorage.setItem('sec_token', d.token);
          onLogin();
        }
      } else { setError(d.error || 'Registration failed'); }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleConfirmTotp = async () => {
    setError('');
    try {
      const r = await fetch(`${API_URL}/api/auth/totp/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${confirmToken}` },
        body: JSON.stringify({ totpCode: confirmCode })
      });
      const d = await r.json();
      if (r.ok) {
        // Save the full access token (not the temp setup token)
        localStorage.setItem('sec_token', d.token || confirmToken);
        onLogin();
      } else { setError(d.error || 'Invalid code. Try again.'); }
    } catch { setError('Network error'); }
  };

  const handleReset = async (e) => {
    e.preventDefault(); setError(''); setResetMsg('');
    if (resetPass !== resetConfirm) { setError('Passwords do not match'); return; }
    if (resetPass.length < 6) { setError('Password must be at least 6 characters'); return; }
    try {
      const r = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, totpCode: resetTotp, newPassword: resetPass })
      });
      const d = await r.json();
      if (r.ok) {
        setResetMsg('Password reset! Redirecting to login...');
        setTimeout(() => { setView('login'); setResetMsg(''); }, 2000);
      } else { setError(d.error || 'Reset failed'); }
    } catch { setError('Network error'); }
  };

  // ==========================================
  // TOTP SETUP (after registration)
  // ==========================================
  if (view === 'totp-setup' && totpSetup) {
    return (
      <div style={styles.screen}>
        <div style={styles.card}>
          <h2 style={styles.title}>Set Up Two-Factor Auth</h2>
          <p style={styles.subtitle}>Add your account to Google Authenticator.</p>
          
          {/* Mobile: tap to open authenticator directly */}
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <a href={totpSetup.uri}
              style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: '#667eea', color: 'white', 
                borderRadius: '4px', textDecoration: 'none', fontSize: '1rem', fontWeight: '500' }}>
              📱 Tap to Add to Authenticator
            </a>
          </div>
          
          <div style={{ textAlign: 'center', color: '#999', marginBottom: '1rem', fontSize: '0.85rem' }}>— or scan QR code on desktop —</div>
          
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpSetup.uri)}`}
              alt="QR Code" style={{ borderRadius: '8px', border: '2px solid #eee' }} />
          </div>
          <div style={{ padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px', marginBottom: '1.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Manual entry key:</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '2px' }}>{totpSetup.secret}</div>
          </div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', fontSize: '0.9rem' }}>Enter 6-digit code to verify:</label>
          <input type="text" value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000" maxLength={6} style={styles.code} />
          {error && <div style={styles.error}>{error}</div>}
          <button onClick={handleConfirmTotp} disabled={confirmCode.length !== 6}
            style={{ ...styles.btnPrimary, background: confirmCode.length === 6 ? '#667eea' : '#ccc', cursor: confirmCode.length === 6 ? 'pointer' : 'not-allowed' }}>
            Verify & Enable 2FA
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // PASSWORD RESET
  // ==========================================
  if (view === 'reset') {
    return (
      <div style={styles.screen}>
        <div style={styles.card}>
          <h2 style={styles.title}>Reset Password</h2>
          <p style={styles.subtitle}>Enter your email and authenticator code.</p>
          <form onSubmit={handleReset}>
            <input type="email" placeholder="Email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required style={styles.input} />
            <input type="text" placeholder="6-digit authenticator code" value={resetTotp}
              onChange={(e) => setResetTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} required style={styles.code} />
            <input type="password" placeholder="New password" value={resetPass} onChange={(e) => setResetPass(e.target.value)} required style={styles.input} />
            <input type="password" placeholder="Confirm new password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} required style={styles.input} />
            {error && <div style={styles.error}>{error}</div>}
            {resetMsg && <div style={styles.success}>{resetMsg}</div>}
            <button type="submit" style={styles.btnPrimary}>Reset Password</button>
          </form>
          <button onClick={() => { setView('login'); setError(''); }} style={styles.btnOutline}>Back to Login</button>
        </div>
      </div>
    );
  }

  // ==========================================
  // LOGIN / REGISTER
  // ==========================================
  return (
    <div style={styles.screen}>
      <div style={styles.card}>
        <h1 style={{ marginBottom: '1.5rem', textAlign: 'center', color: '#333' }}>SEC Filings Tracker</h1>
        <form onSubmit={view === 'login' ? handleLogin : handleRegister}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={styles.input} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required style={styles.input} />

          {needs2FA && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: '#666', fontSize: '0.9rem' }}>Authenticator code:</label>
              <input type="text" placeholder="000000" value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} autoFocus style={styles.code} />
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading}
            style={{ ...styles.btnPrimary, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Loading...' : (needs2FA ? 'Verify' : (view === 'login' ? 'Login' : 'Register'))}
          </button>
        </form>

        <button onClick={() => { setView(view === 'login' ? 'register' : 'login'); setNeeds2FA(false); setTotpCode(''); setError(''); }}
          style={styles.btnOutline}>
          {view === 'login' ? 'Need an account? Register' : 'Have an account? Login'}
        </button>

        {view === 'login' && (
          <button onClick={() => { setView('reset'); setError(''); }}
            style={{ width: '100%', padding: '0.5rem', background: 'transparent', color: '#999', border: 'none', fontSize: '0.85rem', cursor: 'pointer', marginTop: '0.5rem' }}>
            Forgot password?
          </button>
        )}
      </div>
    </div>
  );
}
