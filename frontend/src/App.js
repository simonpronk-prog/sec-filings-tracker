import React, { useState, useEffect, useCallback } from 'react';
import Auth from './Auth';

const API_URL = process.env.REACT_APP_API_URL || 'https://stockmagic.net';

// Filing type descriptions for users
const FILING_TYPES = {
  '10-K': { name: '10-K', desc: 'Annual report — full year financial overview, audited statements', priority: 'high' },
  '10-Q': { name: '10-Q', desc: 'Quarterly report — 3-month financial update', priority: 'high' },
  '8-K': { name: '8-K', desc: 'Major event — mergers, leadership changes, material events', priority: 'high' },
  '4': { name: 'Form 4', desc: 'Insider trading — executive/director buys and sells', priority: 'medium' },
  '144': { name: 'Form 144', desc: 'Notice of proposed insider sale of restricted stock', priority: 'low' },
  'SC 13D': { name: 'SC 13D', desc: 'Large shareholder (5%+) with activist intent', priority: 'high' },
  'SC 13D/A': { name: 'SC 13D/A', desc: 'Amendment to activist shareholder disclosure', priority: 'medium' },
  'SC 13G': { name: 'SC 13G', desc: 'Large shareholder (5%+) passive investment', priority: 'medium' },
  'SC 13G/A': { name: 'SC 13G/A', desc: 'Amendment to passive shareholder disclosure', priority: 'low' },
  'SCHEDULE 13G/A': { name: '13G/A', desc: 'Amendment to passive shareholder disclosure', priority: 'low' },
  'S-1': { name: 'S-1', desc: 'IPO registration — company going public', priority: 'high' },
  'S-3': { name: 'S-3', desc: 'Shelf registration — future stock offering', priority: 'medium' },
  'S-8': { name: 'S-8', desc: 'Employee stock plan registration', priority: 'low' },
  'DEF 14A': { name: 'DEF 14A', desc: 'Proxy statement — shareholder voting matters', priority: 'high' },
  '13F-HR': { name: '13F-HR', desc: 'Institutional holdings report (hedge funds)', priority: 'medium' },
  '20-F': { name: '20-F', desc: 'Annual report for foreign companies', priority: 'high' },
  '6-K': { name: '6-K', desc: 'Foreign company interim report or event', priority: 'medium' },
};

function getFilingInfo(formType) {
  return FILING_TYPES[formType] || { name: formType, desc: 'SEC filing', priority: 'low' };
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('sec_token'));
  const [activeTab, setActiveTab] = useState('dashboard');
  const [watchlist, setWatchlist] = useState([]);
  // Dashboard
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardFilter, setDashboardFilter] = useState('all');
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  // Filings
  const [filings, setFilings] = useState([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [filingsError, setFilingsError] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [filingsSearchQuery, setFilingsSearchQuery] = useState('');
  const [expandedFiling, setExpandedFiling] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'high', 'medium', 'low', or specific type
  const [showTypeInfo, setShowTypeInfo] = useState(false);
  // Settings
  const [aiPreferences, setAiPreferences] = useState({ claude: true, gemini: true, grok: true });
  const [settingsSaving, setSettingsSaving] = useState(false);

  const apiFetch = async (path, options = {}) => {
    const token = localStorage.getItem('sec_token');
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(options.headers || {}) }
    });
  };

  const loadWatchlist = async () => {
    try { const r = await apiFetch('/api/watchlist'); if (r.ok) setWatchlist(await r.json()); } catch (e) {}
  };

  const loadDashboard = async () => {
    setDashboardLoading(true);
    try { const r = await apiFetch('/api/dashboard'); if (r.ok) setDashboard(await r.json()); } catch (e) {}
    finally { setDashboardLoading(false); }
  };

  const loadFilings = useCallback(async () => {
    setFilingsLoading(true); setFilingsError('');
    try {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);
      const daysBack = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
      const r = await apiFetch(`/api/sec/filings?daysBack=${daysBack}`);
      const d = await r.json();
      if (r.ok) setFilings(d); else setFilingsError(d.error || 'Failed');
    } catch { setFilingsError('Network error'); }
    finally { setFilingsLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { if (isAuthenticated) { loadWatchlist(); loadDashboard(); } }, [isAuthenticated]);
  useEffect(() => { if (isAuthenticated && activeTab === 'dashboard') loadDashboard(); }, [activeTab]);
  useEffect(() => { if (isAuthenticated && watchlist.length > 0 && activeTab === 'filings' && filings.length === 0) loadFilings(); }, [watchlist, activeTab, isAuthenticated, loadFilings, filings.length]);

  useEffect(() => {
    if (isAuthenticated) {
      (async () => { try { const r = await apiFetch('/api/preferences'); const d = await r.json(); if (d.ai_preferences) setAiPreferences(d.ai_preferences); } catch {} })();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setTimeout(async () => {
      if (searchQuery.length > 0) {
        try { const r = await apiFetch(`/api/sec/search?query=${encodeURIComponent(searchQuery)}`); if (r.ok) setSearchResults(await r.json()); else setSearchResults([]); }
        catch { setSearchResults([]); }
      } else setSearchResults([]);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, isAuthenticated]);

  if (!isAuthenticated) return <Auth onLogin={() => setIsAuthenticated(true)} />;

  const handleLogout = () => {
    localStorage.removeItem('sec_token');
    setIsAuthenticated(false); setWatchlist([]); setFilings([]); setDashboard(null); setActiveTab('dashboard');
  };

  const addToWatchlist = async (entity) => {
    try { await apiFetch('/api/watchlist', { method: 'POST', body: JSON.stringify(entity) }); setSearchQuery(''); setSearchResults([]); await loadWatchlist(); } catch {}
  };

  const removeFromWatchlist = async (cik) => {
    try { await apiFetch(`/api/watchlist/${cik}`, { method: 'DELETE' }); await loadWatchlist(); } catch {}
  };

  const saveAiPreferences = async (newPrefs) => {
    setSettingsSaving(true);
    try { await apiFetch('/api/preferences', { method: 'PUT', body: JSON.stringify({ aiPreferences: newPrefs }) }); setAiPreferences(newPrefs); } catch {}
    finally { setSettingsSaving(false); }
  };

  // Get unique filing types from loaded filings
  const availableTypes = [...new Set(filings.map(f => f.formType))].sort();

  const filteredFilings = filings.filter(f => {
    // Date filter
    const fDate = new Date(f.filedDate);
    if (fDate < new Date(dateFrom) || fDate > new Date(dateTo + 'T23:59:59')) return false;
    // Text search
    if (filingsSearchQuery) {
      const q = filingsSearchQuery.toLowerCase();
      if (!(f.company?.toLowerCase().includes(q) || f.formType?.toLowerCase().includes(q) || f.ticker?.toLowerCase().includes(q) || f.cik?.toString().includes(q) || f.description?.toLowerCase().includes(q))) return false;
    }
    // Type filter
    if (typeFilter !== 'all') {
      if (typeFilter === 'high' || typeFilter === 'medium' || typeFilter === 'low') {
        const info = getFilingInfo(f.formType);
        if (info.priority !== typeFilter) return false;
      } else {
        if (f.formType !== typeFilter) return false;
      }
    }
    return true;
  });

  const sentiment = (s) => {
    if (!s) return { emoji: '➡️', text: 'NEUTRAL', color: '#666' };
    if (s.toUpperCase() === 'BULLISH') return { emoji: '⬆️', text: 'BULLISH', color: '#28a745' };
    if (s.toUpperCase() === 'BEARISH') return { emoji: '⬇️', text: 'BEARISH', color: '#dc3545' };
    return { emoji: '➡️', text: 'NEUTRAL', color: '#666' };
  };

  const priorityBadge = (p) => { if (!p) return '⚪'; if (p.level === 'high') return '🔴'; if (p.level === 'medium') return '🟡'; return '🟢'; };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ background: 'white', padding: '1rem 2rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, color: '#333', fontSize: '1.3rem' }}>StockMagic</h1>
        <button onClick={handleLogout} style={{ padding: '0.5rem 1rem', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
      </div>

      {/* Tabs */}
      <div style={{ background: 'white', padding: '0 2rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
        {['dashboard', 'watchlist', 'filings', 'settings'].map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '1rem 1.25rem', background: activeTab === t ? '#667eea' : 'transparent',
            color: activeTab === t ? 'white' : '#666', border: 'none',
            borderBottom: activeTab === t ? '3px solid #667eea' : '3px solid transparent',
            cursor: 'pointer', fontWeight: '500', textTransform: 'capitalize', whiteSpace: 'nowrap', fontSize: '0.95rem'
          }}>
            {t === 'dashboard' ? `Dashboard${dashboard?.summary?.totalUnread ? ` (${dashboard.summary.totalUnread})` : ''}` :
             t === 'watchlist' ? `Watchlist (${watchlist.length})` :
             t === 'filings' ? `Filings (${filteredFilings.length})` : 'Settings'}
          </button>
        ))}
      </div>

      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>

        {activeTab === 'dashboard' && (<Dashboard
          dashboard={dashboard} loading={dashboardLoading} filter={dashboardFilter}
          setFilter={setDashboardFilter} onRefresh={loadDashboard} sentiment={sentiment}
          onTickerClick={(q) => { setFilingsSearchQuery(q); setActiveTab('filings'); loadFilings(); }}
        />)}

        {activeTab === 'watchlist' && (<Watchlist
          watchlist={watchlist} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          searchResults={searchResults} onAdd={addToWatchlist} onRemove={removeFromWatchlist}
        />)}

        {activeTab === 'filings' && (<Filings
          filings={filteredFilings} loading={filingsLoading} error={filingsError}
          dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo}
          onRefresh={loadFilings}
          searchQuery={filingsSearchQuery} setSearchQuery={setFilingsSearchQuery}
          expandedFiling={expandedFiling} setExpandedFiling={setExpandedFiling}
          sentiment={sentiment} priorityBadge={priorityBadge} watchlistEmpty={watchlist.length === 0}
          typeFilter={typeFilter} setTypeFilter={setTypeFilter} availableTypes={availableTypes}
          showTypeInfo={showTypeInfo} setShowTypeInfo={setShowTypeInfo}
        />)}

        {activeTab === 'settings' && (<Settings
          aiPreferences={aiPreferences} saving={settingsSaving} onSave={saveAiPreferences}
        />)}
      </div>
    </div>
  );
}

// ============================================
// DASHBOARD COMPONENT
// ============================================
function Dashboard({ dashboard, loading, filter, setFilter, onRefresh, sentiment, onTickerClick }) {
  return (
    <div>
      {dashboard && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Unread', val: dashboard.summary.totalUnread, col: dashboard.summary.totalUnread > 0 ? '#667eea' : '#333' },
            { label: 'Watching', val: dashboard.summary.totalTickers, col: '#333' },
            { label: '⬆️ Bullish', val: dashboard.summary.bullish, col: '#28a745' },
            { label: '⬇️ Bearish', val: dashboard.summary.bearish, col: '#dc3545' }
          ].map((c, i) => (
            <div key={i} style={{ background: 'white', padding: '1.25rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>{c.label}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: c.col }}>{c.val}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[{ k: 'all', l: 'All Tickers' }, { k: 'needle-movers', l: '🎯 Needle Movers' }, { k: 'unread', l: '🔵 Unread Only' }].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)} style={{
            padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.9rem', cursor: 'pointer',
            background: filter === f.k ? '#667eea' : 'white', color: filter === f.k ? 'white' : '#666',
            border: `1px solid ${filter === f.k ? '#667eea' : '#ddd'}`
          }}>{f.l}</button>
        ))}
        <button onClick={onRefresh} disabled={loading} style={{
          padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.9rem', cursor: 'pointer',
          background: 'white', color: '#667eea', border: '1px solid #667eea', marginLeft: 'auto'
        }}>{loading ? '⟳ Loading...' : '⟳ Refresh'}</button>
      </div>

      {loading && !dashboard && <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '8px', color: '#666' }}>Loading...</div>}
      {dashboard && dashboard.tickers.length === 0 && <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '8px', color: '#666' }}>No companies in your watchlist yet.</div>}

      {dashboard && (filter === 'all' || filter === 'unread') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>{filter === 'unread' ? 'Unread Filings' : 'Your Watchlist'}</h2>
          {dashboard.tickers
            .filter(t => filter === 'all' || parseInt(t.unread_count) > 0)
            .map(t => {
              const s = sentiment(t.latest_sentiment);
              return (
                <div key={t.cik} onClick={() => onTickerClick(t.cik)}
                  style={{ background: 'white', padding: '1.25rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    cursor: 'pointer', borderLeft: `4px solid ${s.color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{t.ticker || t.name}</span>
                      {parseInt(t.unread_count) > 0 && <span style={{ background: '#667eea', color: 'white', borderRadius: '12px', padding: '0.15rem 0.6rem', fontSize: '0.75rem', fontWeight: 'bold' }}>{t.unread_count} new</span>}
                      {t.latest_form_type && <span style={{ background: '#f0f0f0', color: '#555', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}>{t.latest_form_type} — {getFilingInfo(t.latest_form_type).desc.split('—')[0].trim()}</span>}
                    </div>
                    <div style={{ color: '#666', fontSize: '0.85rem' }}>{t.name}{t.latest_filing_date && ` · ${new Date(t.latest_filing_date).toLocaleDateString()}`}</div>
                    {t.latest_summary && <div style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.5rem', lineHeight: '1.4' }}>🤖 {t.latest_summary.length > 150 ? t.latest_summary.slice(0, 150) + '...' : t.latest_summary}</div>}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '90px' }}>
                    {t.latest_sentiment ? (<>
                      <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: s.color }}>{s.emoji} {t.latest_move_avg ? `${parseFloat(t.latest_move_avg) > 0 ? '+' : ''}${parseFloat(t.latest_move_avg).toFixed(1)}%` : s.text}</div>
                      {t.latest_confidence && <div style={{ fontSize: '0.75rem', color: '#888' }}>{t.latest_confidence}%</div>}
                    </>) : parseInt(t.total_filings) > 0 ? <div style={{ fontSize: '0.8rem', color: '#999' }}>Pending</div> : null}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {dashboard && (filter === 'needle-movers' || filter === 'all') && dashboard.needleMovers.length > 0 && (
        <div>
          <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>🎯 Needle Movers</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {dashboard.needleMovers.map(f => {
              const s = sentiment(f.sentiment_direction);
              return (
                <div key={f.accession_number} onClick={() => onTickerClick(f.cik)}
                  style={{ background: 'white', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderLeft: f.read ? '3px solid #eee' : '3px solid #667eea' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 'bold' }}>{f.ticker}</span>
                      <span style={{ background: '#f0f0f0', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', color: '#555' }}>{f.form_type} — {getFilingInfo(f.form_type).desc.split('—')[0].trim()}</span>
                      <span style={{ fontSize: '0.8rem', color: '#999' }}>{f.filed_date ? new Date(f.filed_date).toLocaleDateString() : ''}</span>
                    </div>
                    {f.ai_summary && <div style={{ fontSize: '0.85rem', color: '#555' }}>{f.ai_summary.length > 120 ? f.ai_summary.slice(0, 120) + '...' : f.ai_summary}</div>}
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: s.color, minWidth: '70px', textAlign: 'right' }}>
                    {s.emoji} {f.expected_move_avg ? `${parseFloat(f.expected_move_avg) > 0 ? '+' : ''}${parseFloat(f.expected_move_avg).toFixed(1)}%` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// WATCHLIST COMPONENT
// ============================================
function Watchlist({ watchlist, searchQuery, setSearchQuery, searchResults, onAdd, onRemove }) {
  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>Your Watchlist</h2>
      <div style={{ marginBottom: '2rem', position: 'relative' }}>
        <input type="text" placeholder="Search companies or tickers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '12px 16px 12px 40px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', top: '13px' }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        {searchResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '250px', overflowY: 'auto', zIndex: 10 }}>
            {searchResults.map(r => (
              <div key={r.cik} onClick={() => onAdd(r)} style={{ padding: '12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                <div style={{ fontWeight: '600', fontSize: '14px' }}>{r.name}</div>
                <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '2px' }}>{r.ticker} · CIK: {r.cik}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {watchlist.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', background: 'white', borderRadius: '8px', color: '#666' }}>No companies yet. Search above to add.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {watchlist.map(e => (
            <div key={e.cik} style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: '600', fontSize: '14px' }}>{e.name}</div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{e.ticker} · CIK: {e.cik}</div>
              </div>
              <button onClick={() => onRemove(e.cik)} style={{ background: '#fee2e2', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', color: '#dc2626', fontSize: '0.85rem' }}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// FILINGS COMPONENT
// ============================================
function Filings({ filings, loading, error, dateFrom, dateTo, setDateFrom, setDateTo, onRefresh, searchQuery, setSearchQuery, expandedFiling, setExpandedFiling, sentiment, priorityBadge, watchlistEmpty, typeFilter, setTypeFilter, availableTypes, showTypeInfo, setShowTypeInfo }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>Filings</h2>
        <button onClick={() => onRefresh()} disabled={loading} style={{ padding: '0.5rem 1rem', background: '#667eea', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Loading...' : '⟳ Refresh from SEC'}
        </button>
      </div>

      {/* Date range */}
      <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.9rem', color: '#666' }}>From:</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px' }} />
        <label style={{ fontSize: '0.9rem', color: '#666' }}>To:</label>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={{ padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px' }} />
        {/* Quick presets */}
        {[{l: '7d', d: 7}, {l: '30d', d: 30}, {l: '90d', d: 90}].map(p => (
          <button key={p.l} onClick={() => {
            const to = new Date(); const from = new Date(); from.setDate(from.getDate() - p.d);
            setDateFrom(from.toISOString().split('T')[0]); setDateTo(to.toISOString().split('T')[0]);
          }} style={{ padding: '0.3rem 0.6rem', border: '1px solid #ddd', borderRadius: '4px', background: 'white', cursor: 'pointer', fontSize: '0.85rem', color: '#667eea' }}>
            {p.l}
          </button>
        ))}
      </div>

      {/* Search + type filter */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search by ticker, company, CIK..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '200px', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem', boxSizing: 'border-box' }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem', minWidth: '150px' }}>
          <option value="all">All Types</option>
          <option value="high">🔴 High Priority</option>
          <option value="medium">🟡 Medium Priority</option>
          <option value="low">🟢 Low Priority</option>
          <option disabled>──────────</option>
          {availableTypes.map(t => (
            <option key={t} value={t}>{t} — {getFilingInfo(t).desc.slice(0, 40)}</option>
          ))}
        </select>
        <button onClick={() => setShowTypeInfo(!showTypeInfo)}
          style={{ padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', background: showTypeInfo ? '#667eea' : 'white', color: showTypeInfo ? 'white' : '#667eea', cursor: 'pointer', fontSize: '0.9rem' }}>
          ℹ️ Types
        </button>
      </div>

      {/* Filing type reference */}
      {showTypeInfo && (
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #e0e0e0' }}>
          <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem' }}>Filing Type Reference</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.5rem' }}>
            {Object.entries(FILING_TYPES).map(([key, info]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.4rem', borderRadius: '4px', background: '#f9f9f9' }}>
                <span style={{ fontSize: '0.7rem', marginTop: '2px' }}>
                  {info.priority === 'high' ? '🔴' : info.priority === 'medium' ? '🟡' : '🟢'}
                </span>
                <div>
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>{key}</span>
                  <span style={{ fontSize: '0.8rem', color: '#666', marginLeft: '0.5rem' }}>{info.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div style={{ padding: '1rem', background: '#f8d7da', color: '#721c24', borderRadius: '4px', marginBottom: '1rem' }}>{error}</div>}

      {watchlistEmpty ? (
        <div style={{ textAlign: 'center', padding: '2rem', background: 'white', borderRadius: '8px', color: '#666' }}>Add companies to your watchlist first.</div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', background: 'white', borderRadius: '8px', color: '#666' }}>Loading filings...</div>
      ) : filings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', background: 'white', borderRadius: '8px', color: '#666' }}>{searchQuery || typeFilter !== 'all' ? 'No matches for current filters.' : 'No filings in this date range. Try a wider range or click Refresh.'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filings.map(f => {
            const isExp = expandedFiling === f.accessionNumber;
            const s = sentiment(f.sentiment_direction);
            const info = getFilingInfo(f.formType);
            const has = f.ai_summary;
            return (
              <div key={f.accessionNumber || f.id} style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                <div style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                      <span style={{ fontSize: '1.2rem' }}>{info.priority === 'high' ? '🔴' : info.priority === 'medium' ? '🟡' : '🟢'}</span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{f.ticker || f.company || 'Unknown'}</span>
                          <span style={{ padding: '0.25rem 0.5rem', background: '#667eea', color: 'white', borderRadius: '4px', fontSize: '0.85rem' }}>{f.formType} — {getFilingInfo(f.formType).desc.split('—')[0].trim()}</span>
                        </div>
                        <div style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                          {info.desc} · Filed: {f.filedDate ? new Date(f.filedDate).toLocaleDateString() : 'N/A'}
                        </div>
                        {f.company && f.ticker && <div style={{ color: '#888', fontSize: '0.8rem' }}>{f.company}</div>}
                      </div>
                    </div>
                    {has && f.expected_move_avg && (
                      <div style={{ textAlign: 'right', minWidth: '110px' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: s.color }}>{s.emoji} {f.expected_move_avg > 0 ? '+' : ''}{f.expected_move_avg}%</div>
                        <div style={{ fontSize: '0.75rem', color: '#666' }}>({f.confidence_score}% sure)</div>
                      </div>
                    )}
                  </div>
                  {has && <div style={{ padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px', borderLeft: `4px solid ${s.color}`, fontSize: '0.95rem', lineHeight: '1.5', color: '#333' }}>🤖 {f.ai_summary}</div>}
                  {has && f.numbers_confidence === 'low' && <div style={{ padding: '0.5rem 0.75rem', background: '#fff3cd', borderRadius: '4px', borderLeft: '4px solid #ffc107', fontSize: '0.85rem', color: '#856404', marginTop: '0.5rem' }}>⚠️ Numbers in this analysis may be approximate — the filing text was unclear or truncated</div>}
                  {!has && <div style={{ padding: '0.75rem', background: '#fff9e6', borderRadius: '4px', borderLeft: '4px solid #ffc107', fontSize: '0.9rem', color: '#856404' }}>⏳ AI analysis pending — will be processed on next check</div>}
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=${f.formType}&dateb=&owner=exclude&count=40`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ padding: '0.5rem 1rem', background: '#667eea', color: 'white', textDecoration: 'none', borderRadius: '4px', fontSize: '0.9rem' }}>
                      View Filing ↗
                    </a>
                    {has && <button onClick={() => setExpandedFiling(isExp ? null : f.accessionNumber)}
                      style={{ padding: '0.5rem 1rem', background: 'white', color: '#667eea', border: '2px solid #667eea', borderRadius: '4px', fontSize: '0.9rem', cursor: 'pointer' }}>
                      📊 {isExp ? 'Hide' : 'Full'} Analysis
                    </button>}
                  </div>
                </div>
                {isExp && has && (
                  <div style={{ padding: '1.5rem', borderTop: '2px solid #f0f0f0', background: '#fafafa' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>💡 Stock Impact</h3>
                    <div style={{ marginBottom: '0.5rem' }}><strong>Direction:</strong> {s.emoji} {s.text}</div>
                    <div style={{ marginBottom: '0.5rem' }}><strong>Expected:</strong> {f.expected_move_min}% to {f.expected_move_max}% (avg {f.expected_move_avg}%)</div>
                    <div style={{ marginBottom: '1rem' }}><strong>Confidence:</strong> {f.confidence_score}%</div>
                    {f.bullish_factors?.length > 0 && <div style={{ marginBottom: '0.75rem' }}><div style={{ fontWeight: '600', color: '#28a745', marginBottom: '0.25rem' }}>Bullish:</div>{f.bullish_factors.map((x, i) => <div key={i} style={{ fontSize: '0.9rem', color: '#333', marginLeft: '1rem' }}>• {x}</div>)}</div>}
                    {f.bearish_factors?.length > 0 && <div style={{ marginBottom: '0.75rem' }}><div style={{ fontWeight: '600', color: '#dc3545', marginBottom: '0.25rem' }}>Bearish:</div>{f.bearish_factors.map((x, i) => <div key={i} style={{ fontSize: '0.9rem', color: '#333', marginLeft: '1rem' }}>• {x}</div>)}</div>}
                    {f.ai_consensus?.analyses && (
                      <div style={{ padding: '0.75rem', background: 'white', borderRadius: '4px', border: '1px solid #e0e0e0', marginTop: '1rem' }}>
                        <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>AI Consensus ({f.ai_consensus.provider_count} models):</div>
                        {f.ai_consensus.analyses.map((a, i) => (
                          <div key={i} style={{ fontSize: '0.9rem', color: '#555' }}>
                            {a.provider}: {a.sentiment === 'bullish' ? '⬆️' : a.sentiment === 'bearish' ? '⬇️' : '➡️'} {a.expected_move > 0 ? '+' : ''}{a.expected_move}% ({a.confidence}%)
                          </div>
                        ))}
                      </div>
                    )}
                    {f.short_interest_percent && (
                      <div style={{ padding: '0.75rem', background: 'white', borderRadius: '4px', border: '1px solid #e0e0e0', marginTop: '1rem' }}>
                        <div style={{ fontWeight: '600' }}>Short Interest: {f.short_interest_percent}%{f.short_interest_percent > 15 ? ' 🚀' : ''}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// SETTINGS COMPONENT
// ============================================
function Settings({ aiPreferences, saving, onSave }) {
  const models = [
    { key: 'claude', name: 'Anthropic Claude Sonnet 4.5', desc: 'Nuanced insights and detailed reasoning.', cost: '~$0.018/filing', badge: 'PAID', badgeColor: '#ffc107' },
    { key: 'grok', name: 'xAI Grok 2', desc: 'Fast analysis with trading focus.', cost: '~$0.001/filing', badge: 'PAID', badgeColor: '#ffc107' },
    { key: 'gemini', name: 'Google Gemini 2.0 Flash', desc: 'Fast and accurate financial analysis.', cost: 'Free tier available', badge: 'FREE', badgeColor: '#28a745' },
  ];
  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>Settings</h2>

      {/* 2FA Status */}
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Two-Factor Authentication</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#28a745', display: 'inline-block' }} />
          <span style={{ color: '#28a745', fontWeight: '500' }}>2FA is enabled (mandatory for all accounts)</span>
        </div>
      </div>

      {/* AI Models */}
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>AI Analysis Models</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {models.map(m => (
            <div key={m.key} style={{
              padding: '1rem', border: `2px solid ${aiPreferences[m.key] ? '#667eea' : '#ddd'}`, borderRadius: '8px',
              display: 'flex', alignItems: 'flex-start', gap: '1rem', background: aiPreferences[m.key] ? '#f0f7ff' : 'white'
            }}>
              <input type="checkbox" checked={aiPreferences[m.key]} disabled={saving}
                onChange={e => onSave({ ...aiPreferences, [m.key]: e.target.checked })}
                style={{ marginTop: '0.25rem', cursor: 'pointer' }} />
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                  {m.name} <span style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', background: m.badgeColor, color: m.badgeColor === '#ffc107' ? '#333' : 'white', borderRadius: '4px', fontSize: '0.7rem' }}>{m.badge}</span>
                </div>
                <div style={{ color: '#666', fontSize: '0.9rem' }}>{m.desc}</div>
                <div style={{ fontSize: '0.85rem', color: '#888' }}>Cost: {m.cost}</div>
              </div>
            </div>
          ))}
        </div>
        {saving && <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#d1ecf1', color: '#0c5460', borderRadius: '4px', fontSize: '0.9rem' }}>Saving...</div>}
      </div>
    </div>
  );
}

export default App;
