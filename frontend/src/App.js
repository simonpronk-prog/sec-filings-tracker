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
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  // Settings
  const [aiPreferences, setAiPreferences] = useState({ claude: true, gemini: true, grok: true });
  const [settingsSaving, setSettingsSaving] = useState(false);
  // Expandable watchlist state
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [tickerFilings, setTickerFilings] = useState({});
  const [tickerFilingsLoading, setTickerFilingsLoading] = useState({});
  const [hideRead, setHideRead] = useState(false);
  const [expandedFiling, setExpandedFiling] = useState(null);
  // Stock prices
  const [stockPrices, setStockPrices] = useState({});
  // Unread filter (when clicking the Unread tile)
  const [unreadFilter, setUnreadFilter] = useState(false);

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

  const loadStockPrices = async () => {
    try { const r = await apiFetch('/api/stock-prices'); if (r.ok) setStockPrices(await r.json()); } catch (e) {}
  };

  // Load filings for a single CIK when expanding
  const loadTickerFilings = async (cik) => {
    if (tickerFilingsLoading[cik]) return;
    setTickerFilingsLoading(prev => ({ ...prev, [cik]: true }));
    try {
      const r = await apiFetch(`/api/sec/filings/${cik}?daysBack=90`);
      if (r.ok) {
        const data = await r.json();
        setTickerFilings(prev => ({ ...prev, [cik]: data }));
      }
    } catch (e) {
      console.error('Error loading filings for CIK:', cik, e);
    }
    finally { setTickerFilingsLoading(prev => ({ ...prev, [cik]: false })); }
  };

  // Mark a filing as read
  const markAsRead = async (accessionNumber, cik) => {
    try {
      await apiFetch(`/api/filings/${encodeURIComponent(accessionNumber)}/read`, { method: 'POST' });
      // Update local state immediately (optimistic)
      setTickerFilings(prev => ({
        ...prev,
        [cik]: (prev[cik] || []).map(f =>
          f.accessionNumber === accessionNumber ? { ...f, read: true } : f
        )
      }));
      // Update dashboard unread counts
      if (dashboard) {
        setDashboard(prev => ({
          ...prev,
          tickers: prev.tickers.map(t =>
            t.cik === cik ? { ...t, unread_count: Math.max(0, parseInt(t.unread_count || 0) - 1).toString() } : t
          ),
          needleMovers: prev.needleMovers.map(f =>
            f.accession_number === accessionNumber ? { ...f, read: true } : f
          ),
          summary: {
            ...prev.summary,
            totalUnread: Math.max(0, prev.summary.totalUnread - 1)
          }
        }));
      }
    } catch (e) {
      console.error('Error marking as read:', e);
    }
  };

  // Toggle expanded ticker
  const toggleTicker = (cik) => {
    if (expandedTicker === cik) {
      setExpandedTicker(null);
    } else {
      setExpandedTicker(cik);
      if (!tickerFilings[cik]) {
        loadTickerFilings(cik);
      }
    }
  };

  useEffect(() => { if (isAuthenticated) { loadWatchlist(); loadDashboard(); loadStockPrices(); } }, [isAuthenticated]);
  useEffect(() => { if (isAuthenticated && activeTab === 'dashboard' && !dashboard) loadDashboard(); }, [activeTab]);

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
    setIsAuthenticated(false); setWatchlist([]); setDashboard(null); setActiveTab('dashboard');
    setTickerFilings({}); setExpandedTicker(null);
  };

  const addToWatchlist = async (entity) => {
    try { await apiFetch('/api/watchlist', { method: 'POST', body: JSON.stringify(entity) }); setSearchQuery(''); setSearchResults([]); await loadWatchlist(); await loadDashboard(); } catch {}
  };

  const removeFromWatchlist = async (cik) => {
    try { await apiFetch(`/api/watchlist/${cik}`, { method: 'DELETE' }); await loadWatchlist(); await loadDashboard(); } catch {}
  };

  const saveAiPreferences = async (newPrefs) => {
    setSettingsSaving(true);
    try { await apiFetch('/api/preferences', { method: 'PUT', body: JSON.stringify({ aiPreferences: newPrefs }) }); setAiPreferences(newPrefs); } catch {}
    finally { setSettingsSaving(false); }
  };

  const sentiment = (s) => {
    if (!s) return { emoji: '➡️', text: 'NEUTRAL', color: '#666' };
    if (s.toUpperCase() === 'BULLISH') return { emoji: '⬆️', text: 'BULLISH', color: '#28a745' };
    if (s.toUpperCase() === 'BEARISH') return { emoji: '⬇️', text: 'BEARISH', color: '#dc3545' };
    return { emoji: '➡️', text: 'NEUTRAL', color: '#666' };
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ background: 'white', padding: '1rem 2rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, color: '#333', fontSize: '1.3rem' }}>StockMagic</h1>
        <button onClick={handleLogout} style={{ padding: '0.5rem 1rem', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
      </div>

      {/* Tabs */}
      <div style={{ background: 'white', padding: '0 2rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
        {['dashboard', 'watchlist', 'settings'].map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '1rem 1.25rem', background: activeTab === t ? '#667eea' : 'transparent',
            color: activeTab === t ? 'white' : '#666', border: 'none',
            borderBottom: activeTab === t ? '3px solid #667eea' : '3px solid transparent',
            cursor: 'pointer', fontWeight: '500', textTransform: 'capitalize', whiteSpace: 'nowrap', fontSize: '0.95rem'
          }}>
            {t === 'dashboard' ? `Dashboard${dashboard?.summary?.totalUnread ? ` (${dashboard.summary.totalUnread})` : ''}` :
             t === 'watchlist' ? `Watchlist (${watchlist.length})` : 'Settings'}
          </button>
        ))}
      </div>

      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>

        {activeTab === 'dashboard' && (
          <Dashboard
            dashboard={dashboard} loading={dashboardLoading} sentiment={sentiment}
            onRefresh={() => { loadDashboard(); loadStockPrices(); setTickerFilings({}); }}
            expandedTicker={expandedTicker} toggleTicker={toggleTicker}
            tickerFilings={tickerFilings} tickerFilingsLoading={tickerFilingsLoading}
            hideRead={hideRead} setHideRead={setHideRead}
            markAsRead={markAsRead} expandedFiling={expandedFiling} setExpandedFiling={setExpandedFiling}
            stockPrices={stockPrices}
            unreadFilter={unreadFilter} setUnreadFilter={setUnreadFilter}
          />
        )}

        {activeTab === 'watchlist' && (<Watchlist
          watchlist={watchlist} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          searchResults={searchResults} onAdd={addToWatchlist} onRemove={removeFromWatchlist}
        />)}

        {activeTab === 'settings' && (<Settings
          aiPreferences={aiPreferences} saving={settingsSaving} onSave={saveAiPreferences}
        />)}
      </div>
    </div>
  );
}

// ============================================
// DASHBOARD COMPONENT — Expandable Watchlist
// ============================================
function Dashboard({ dashboard, loading, sentiment, onRefresh, expandedTicker, toggleTicker, tickerFilings, tickerFilingsLoading, hideRead, setHideRead, markAsRead, expandedFiling, setExpandedFiling, stockPrices, unreadFilter, setUnreadFilter }) {
  return (
    <div>
      {/* Summary cards */}
      {dashboard && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Unread', val: dashboard.summary.totalUnread, col: dashboard.summary.totalUnread > 0 ? '#667eea' : '#333', clickable: true },
            { label: 'Watching', val: dashboard.summary.totalTickers, col: '#333' },
            { label: '⬆️ Bullish', val: dashboard.summary.bullish, col: '#28a745' },
            { label: '⬇️ Bearish', val: dashboard.summary.bearish, col: '#dc3545' }
          ].map((c, i) => (
            <div key={i} onClick={c.clickable ? () => setUnreadFilter(!unreadFilter) : undefined}
              style={{ background: c.clickable && unreadFilter ? '#667eea' : 'white', padding: '1.25rem', borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)', cursor: c.clickable ? 'pointer' : 'default',
                transition: 'all 0.2s', border: c.clickable && unreadFilter ? '2px solid #5a6fd6' : '2px solid transparent' }}>
              <div style={{ fontSize: '0.85rem', color: c.clickable && unreadFilter ? 'rgba(255,255,255,0.8)' : '#666' }}>{c.label}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: c.clickable && unreadFilter ? 'white' : c.col }}>{c.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls bar */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', flex: 1 }}>{unreadFilter ? 'Unread Filings' : 'Your Watchlist'}</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#666',
          background: hideRead ? '#667eea' : 'white', color: hideRead ? 'white' : '#666',
          padding: '0.5rem 1rem', borderRadius: '20px', border: `1px solid ${hideRead ? '#667eea' : '#ddd'}` }}>
          <input type="checkbox" checked={hideRead} onChange={e => setHideRead(e.target.checked)}
            style={{ display: 'none' }} />
          {hideRead ? '👁️ Hiding read' : '👁️ Show all'}
        </label>
        <button onClick={onRefresh} disabled={loading} style={{
          padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.9rem', cursor: 'pointer',
          background: 'white', color: '#667eea', border: '1px solid #667eea'
        }}>{loading ? '⟳ Loading...' : '⟳ Refresh'}</button>
      </div>

      {loading && !dashboard && <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '8px', color: '#666' }}>Loading...</div>}
      {dashboard && dashboard.tickers.length === 0 && <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '8px', color: '#666' }}>No companies in your watchlist yet. Go to the Watchlist tab to add some.</div>}

      {/* Expandable ticker cards */}
      {dashboard && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {dashboard.tickers
            .filter(t => !unreadFilter || parseInt(t.unread_count || 0) > 0)
            .map(t => {
            const s = sentiment(t.latest_sentiment);
            const isExpanded = expandedTicker === t.cik;
            const unread = parseInt(t.unread_count || 0);
            const filings = tickerFilings[t.cik] || [];
            const isLoadingFilings = tickerFilingsLoading[t.cik];
            const visibleFilings = hideRead ? filings.filter(f => !f.read) : filings;
            const price = stockPrices[t.ticker];

            return (
              <div key={t.cik} style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                {/* Ticker header — click to expand */}
                <div onClick={() => toggleTicker(t.cik)}
                  style={{ padding: '1.25rem', cursor: 'pointer', borderLeft: `4px solid ${s.color}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: isExpanded ? '#f8f9ff' : 'white' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{t.ticker || t.name}</span>
                      {price && (
                        <span style={{ fontSize: '0.95rem', fontWeight: '600', color: price.change >= 0 ? '#28a745' : '#dc3545' }}>
                          ${price.price.toFixed(2)} <span style={{ fontSize: '0.8rem' }}>{price.change >= 0 ? '▲' : '▼'} {price.change >= 0 ? '+' : ''}{price.changePercent.toFixed(2)}%</span>
                        </span>
                      )}
                      {unread > 0 && <span style={{ background: '#667eea', color: 'white', borderRadius: '12px', padding: '0.15rem 0.6rem', fontSize: '0.75rem', fontWeight: 'bold' }}>{unread} new</span>}
                      {t.latest_form_type && <span style={{ background: '#f0f0f0', color: '#555', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}>{t.latest_form_type} — {getFilingInfo(t.latest_form_type).desc.split('—')[0].trim()}</span>}
                    </div>
                    <div style={{ color: '#666', fontSize: '0.85rem' }}>{t.name}{t.latest_filing_date && ` · ${new Date(t.latest_filing_date).toLocaleDateString()}`}</div>
                    {!isExpanded && t.latest_summary && <div style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.5rem', lineHeight: '1.4' }}>🤖 {t.latest_summary.length > 150 ? t.latest_summary.slice(0, 150) + '...' : t.latest_summary}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {t.latest_sentiment ? (
                      <div style={{ textAlign: 'right', minWidth: '90px' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: s.color }}>{s.emoji} {t.latest_move_avg ? `${parseFloat(t.latest_move_avg) > 0 ? '+' : ''}${parseFloat(t.latest_move_avg).toFixed(1)}%` : s.text}</div>
                        {t.latest_confidence && <div style={{ fontSize: '0.75rem', color: '#888' }}>{t.latest_confidence}%</div>}
                      </div>
                    ) : parseInt(t.total_filings) > 0 ? <div style={{ fontSize: '0.8rem', color: '#999' }}>Pending</div> : null}
                    <span style={{ fontSize: '1.2rem', color: '#999', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                  </div>
                </div>

                {/* Expanded filings list */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #eee', padding: '0.75rem 1.25rem' }}>
                    {isLoadingFilings && (
                      <div style={{ textAlign: 'center', padding: '1.5rem', color: '#666' }}>Loading filings...</div>
                    )}
                    {!isLoadingFilings && visibleFilings.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '1.5rem', color: '#999', fontSize: '0.9rem' }}>
                        {hideRead && filings.length > 0 ? 'All filings marked as read. Toggle "Show all" to see them.' : 'No filings in the last 90 days.'}
                      </div>
                    )}
                    {!isLoadingFilings && visibleFilings.map(f => {
                      const fs = sentiment(f.sentiment_direction);
                      const info = getFilingInfo(f.formType);
                      const has = f.ai_summary;
                      const isFilingExpanded = expandedFiling === f.accessionNumber;

                      return (
                        <div key={f.accessionNumber} style={{
                          padding: '1rem', marginBottom: '0.5rem', borderRadius: '6px',
                          border: f.read ? '1px solid #eee' : '1px solid #c5cdf5',
                          borderLeft: f.read ? '3px solid #eee' : '3px solid #667eea',
                          background: f.read ? '#fafafa' : '#fdfdff',
                          opacity: f.read ? 0.7 : 1
                        }}>
                          {/* Filing header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                                <span style={{ fontSize: '0.9rem' }}>{info.priority === 'high' ? '🔴' : info.priority === 'medium' ? '🟡' : '🟢'}</span>
                                <span style={{ padding: '0.2rem 0.5rem', background: '#667eea', color: 'white', borderRadius: '4px', fontSize: '0.8rem', fontWeight: '500' }}>{f.formType}</span>
                                <span style={{ fontSize: '0.8rem', color: '#666' }}>{info.desc.split('—')[0].trim()}</span>
                                <span style={{ fontSize: '0.8rem', color: '#999' }}>{f.filedDate ? new Date(f.filedDate).toLocaleDateString() : ''}</span>
                              </div>
                              {has && <div style={{ fontSize: '0.9rem', color: '#333', lineHeight: '1.5', marginTop: '0.25rem' }}>🤖 {f.ai_summary}</div>}
                              {has && f.numbers_confidence === 'low' && <div style={{ fontSize: '0.8rem', color: '#856404', marginTop: '0.25rem' }}>⚠️ Numbers may be approximate</div>}
                              {!has && <div style={{ fontSize: '0.85rem', color: '#856404', marginTop: '0.25rem' }}>⏳ AI analysis pending</div>}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem', minWidth: '100px' }}>
                              {has && f.expected_move_avg && (
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: fs.color }}>{fs.emoji} {f.expected_move_avg > 0 ? '+' : ''}{f.expected_move_avg}%</div>
                                  <div style={{ fontSize: '0.7rem', color: '#888' }}>{f.confidence_score}% confident</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {!f.read && (
                              <button onClick={(e) => { e.stopPropagation(); markAsRead(f.accessionNumber, t.cik); }}
                                style={{ padding: '0.35rem 0.75rem', background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9',
                                  borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: '500' }}>
                                ✓ Mark read
                              </button>
                            )}
                            {f.read && (
                              <span style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', color: '#999' }}>✓ Read</span>
                            )}
                            <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=${f.formType}&dateb=&owner=exclude&count=40`}
                              target="_blank" rel="noopener noreferrer"
                              style={{ padding: '0.35rem 0.75rem', background: '#667eea', color: 'white', textDecoration: 'none',
                                borderRadius: '4px', fontSize: '0.8rem' }}>
                              View Filing ↗
                            </a>
                            {has && (
                              <button onClick={(e) => { e.stopPropagation(); setExpandedFiling(isFilingExpanded ? null : f.accessionNumber); }}
                                style={{ padding: '0.35rem 0.75rem', background: 'white', color: '#667eea', border: '1px solid #667eea',
                                  borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}>
                                📊 {isFilingExpanded ? 'Hide' : 'Full'} Analysis
                              </button>
                            )}
                          </div>

                          {/* Expanded full analysis */}
                          {isFilingExpanded && has && (
                            <div style={{ marginTop: '0.75rem', padding: '1rem', background: '#f8f9fa', borderRadius: '6px', borderTop: '1px solid #eee' }}>
                              <div style={{ marginBottom: '0.5rem' }}><strong>Direction:</strong> {fs.emoji} {fs.text}</div>
                              <div style={{ marginBottom: '0.5rem' }}><strong>Expected:</strong> {f.expected_move_min}% to {f.expected_move_max}% (avg {f.expected_move_avg}%)</div>
                              <div style={{ marginBottom: '0.75rem' }}><strong>Confidence:</strong> {f.confidence_score}%</div>
                              {f.bullish_factors?.length > 0 && (
                                <div style={{ marginBottom: '0.5rem' }}>
                                  <div style={{ fontWeight: '600', color: '#28a745', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Bullish:</div>
                                  {f.bullish_factors.map((x, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#333', marginLeft: '1rem' }}>• {x}</div>)}
                                </div>
                              )}
                              {f.bearish_factors?.length > 0 && (
                                <div style={{ marginBottom: '0.5rem' }}>
                                  <div style={{ fontWeight: '600', color: '#dc3545', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Bearish:</div>
                                  {f.bearish_factors.map((x, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#333', marginLeft: '1rem' }}>• {x}</div>)}
                                </div>
                              )}
                              {f.ai_consensus?.analyses && (
                                <div style={{ padding: '0.75rem', background: 'white', borderRadius: '4px', border: '1px solid #e0e0e0', marginTop: '0.5rem' }}>
                                  <div style={{ fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>AI Consensus ({f.ai_consensus.provider_count} models):</div>
                                  {f.ai_consensus.analyses.map((a, i) => (
                                    <div key={i} style={{ fontSize: '0.85rem', color: '#555' }}>
                                      {a.provider}: {a.sentiment === 'bullish' ? '⬆️' : a.sentiment === 'bearish' ? '⬇️' : '➡️'} {a.expected_move > 0 ? '+' : ''}{a.expected_move}% ({a.confidence}%)
                                    </div>
                                  ))}
                                </div>
                              )}
                              {f.short_interest_percent && (
                                <div style={{ padding: '0.75rem', background: 'white', borderRadius: '4px', border: '1px solid #e0e0e0', marginTop: '0.5rem' }}>
                                  <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>Short Interest: {f.short_interest_percent}%{f.short_interest_percent > 15 ? ' 🚀' : ''}</div>
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
          })}
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
// SETTINGS COMPONENT
// ============================================
function Settings({ aiPreferences, saving, onSave }) {
  const models = [
    { key: 'claude', name: 'Anthropic Claude Sonnet 4', desc: 'Nuanced insights and detailed reasoning.', cost: '~$0.018/filing', badge: 'PAID', badgeColor: '#ffc107' },
    { key: 'grok', name: 'xAI Grok 3', desc: 'Fast analysis with trading focus.', cost: '~$0.001/filing', badge: 'PAID', badgeColor: '#ffc107' },
    { key: 'gemini', name: 'Google Gemini 1.5 Pro', desc: 'Fast and accurate financial analysis.', cost: 'Free tier available', badge: 'FREE', badgeColor: '#28a745' },
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
