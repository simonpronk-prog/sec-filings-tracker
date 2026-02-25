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
  // Bulk select: { cik: Set of accessionNumbers }
  const [selectedFilings, setSelectedFilings] = useState({});
  // Filing type filter: 'all', 'important', 'insider', or a Set of types
  const [typeFilter, setTypeFilter] = useState('all');
  // Analyst personas
  const [personas, setPersonas] = useState([]);
  const [personasLoading, setPersonasLoading] = useState(false);
  const [personaPreferences, setPersonaPreferences] = useState(null);
  // Re-analyse loading state: accessionNumber → true while loading
  const [reanalyzing, setReanalyzing] = useState({});

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

  const loadPersonas = async () => {
    try { const r = await apiFetch('/api/personas'); if (r.ok) setPersonas(await r.json()); } catch (e) {}
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

  // Mark a filing as unread
  const markAsUnread = async (accessionNumber, cik) => {
    try {
      await apiFetch(`/api/filings/${encodeURIComponent(accessionNumber)}/unread`, { method: 'POST' });
      setTickerFilings(prev => ({
        ...prev,
        [cik]: (prev[cik] || []).map(f =>
          f.accessionNumber === accessionNumber ? { ...f, read: false } : f
        )
      }));
      if (dashboard) {
        setDashboard(prev => ({
          ...prev,
          tickers: prev.tickers.map(t =>
            t.cik === cik ? { ...t, unread_count: (parseInt(t.unread_count || 0) + 1).toString() } : t
          ),
          summary: { ...prev.summary, totalUnread: prev.summary.totalUnread + 1 }
        }));
      }
    } catch (e) {
      console.error('Error marking as unread:', e);
    }
  };

  // Bulk mark filings as unread
  const bulkMarkAsUnread = async (cik) => {
    const selected = selectedFilings[cik];
    if (!selected || selected.size === 0) return;
    const accessionNumbers = [...selected];
    // Only count ones that are currently read (to update unread count correctly)
    const currentFilings = tickerFilings[cik] || [];
    const readCount = accessionNumbers.filter(an => {
      const f = currentFilings.find(fi => fi.accessionNumber === an);
      return f && f.read;
    }).length;
    try {
      await apiFetch('/api/filings/bulk-unread', {
        method: 'POST',
        body: JSON.stringify({ accessionNumbers })
      });
      setTickerFilings(prev => ({
        ...prev,
        [cik]: (prev[cik] || []).map(f =>
          selected.has(f.accessionNumber) ? { ...f, read: false } : f
        )
      }));
      if (dashboard && readCount > 0) {
        setDashboard(prev => ({
          ...prev,
          tickers: prev.tickers.map(t =>
            t.cik === cik ? { ...t, unread_count: (parseInt(t.unread_count || 0) + readCount).toString() } : t
          ),
          summary: { ...prev.summary, totalUnread: prev.summary.totalUnread + readCount }
        }));
      }
      setSelectedFilings(prev => ({ ...prev, [cik]: new Set() }));
    } catch (e) {
      console.error('Bulk unread error:', e);
    }
  };

  // Bulk mark filings as read
  const bulkMarkAsRead = async (cik) => {
    const selected = selectedFilings[cik];
    if (!selected || selected.size === 0) return;
    const accessionNumbers = [...selected];
    try {
      await apiFetch('/api/filings/bulk-read', {
        method: 'POST',
        body: JSON.stringify({ accessionNumbers })
      });
      // Optimistic update
      setTickerFilings(prev => ({
        ...prev,
        [cik]: (prev[cik] || []).map(f =>
          selected.has(f.accessionNumber) ? { ...f, read: true } : f
        )
      }));
      // Update dashboard counts
      const count = accessionNumbers.length;
      if (dashboard) {
        setDashboard(prev => ({
          ...prev,
          tickers: prev.tickers.map(t =>
            t.cik === cik ? { ...t, unread_count: Math.max(0, parseInt(t.unread_count || 0) - count).toString() } : t
          ),
          summary: { ...prev.summary, totalUnread: Math.max(0, prev.summary.totalUnread - count) }
        }));
      }
      // Clear selection
      setSelectedFilings(prev => ({ ...prev, [cik]: new Set() }));
    } catch (e) {
      console.error('Bulk read error:', e);
    }
  };

  // Re-analyse a filing with fresh AI + pro analysis
  const reanalyzeFiling = async (accessionNumber, cik) => {
    setReanalyzing(prev => ({ ...prev, [accessionNumber]: true }));
    try {
      const r = await apiFetch(`/api/filings/${accessionNumber}/analyze`, { method: 'POST' });
      if (r.ok) {
        const updatedAnalysis = await r.json();
        // Update the filing in tickerFilings with fresh analysis
        setTickerFilings(prev => {
          const filings = prev[cik] || [];
          return {
            ...prev,
            [cik]: filings.map(f =>
              f.accessionNumber === accessionNumber || f.accession_number === accessionNumber
                ? { ...f, ...updatedAnalysis, ai_summary: updatedAnalysis.brief_summary || updatedAnalysis.ai_summary }
                : f
            )
          };
        });
      }
    } catch (e) {
      console.error('Re-analyse error:', e);
    }
    setReanalyzing(prev => ({ ...prev, [accessionNumber]: false }));
  };

  // Toggle filing selection
  const toggleFilingSelection = (cik, accessionNumber) => {
    setSelectedFilings(prev => {
      const current = new Set(prev[cik] || []);
      if (current.has(accessionNumber)) current.delete(accessionNumber);
      else current.add(accessionNumber);
      return { ...prev, [cik]: current };
    });
  };

  // Select/deselect all visible filings for a CIK
  const toggleSelectAll = (cik, visibleFilings) => {
    setSelectedFilings(prev => {
      const current = new Set(prev[cik] || []);
      const allSelected = visibleFilings.every(f => current.has(f.accessionNumber));
      if (allSelected) {
        return { ...prev, [cik]: new Set() };
      } else {
        return { ...prev, [cik]: new Set(visibleFilings.map(f => f.accessionNumber)) };
      }
    });
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

  useEffect(() => { if (isAuthenticated) { loadWatchlist(); loadDashboard(); loadStockPrices(); loadPersonas(); } }, [isAuthenticated]);
  useEffect(() => { if (isAuthenticated && activeTab === 'dashboard' && !dashboard) loadDashboard(); }, [activeTab]);

  useEffect(() => {
    if (isAuthenticated) {
      (async () => { try { const r = await apiFetch('/api/preferences'); const d = await r.json(); if (d.ai_preferences) setAiPreferences(d.ai_preferences); if (d.persona_preferences) setPersonaPreferences(d.persona_preferences); } catch {} })();
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
            onRefresh={() => { loadDashboard(); loadStockPrices(); setTickerFilings({}); setSelectedFilings({}); }}
            expandedTicker={expandedTicker} toggleTicker={toggleTicker}
            tickerFilings={tickerFilings} tickerFilingsLoading={tickerFilingsLoading}
            hideRead={hideRead} setHideRead={setHideRead}
            markAsRead={markAsRead} markAsUnread={markAsUnread}
            expandedFiling={expandedFiling} setExpandedFiling={setExpandedFiling}
            stockPrices={stockPrices}
            unreadFilter={unreadFilter} setUnreadFilter={setUnreadFilter}
            selectedFilings={selectedFilings} toggleFilingSelection={toggleFilingSelection}
            toggleSelectAll={toggleSelectAll} bulkMarkAsRead={bulkMarkAsRead} bulkMarkAsUnread={bulkMarkAsUnread}
            typeFilter={typeFilter} setTypeFilter={setTypeFilter}
            reanalyzeFiling={reanalyzeFiling} reanalyzing={reanalyzing}
          />
        )}

        {activeTab === 'watchlist' && (<Watchlist
          watchlist={watchlist} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          searchResults={searchResults} onAdd={addToWatchlist} onRemove={removeFromWatchlist}
        />)}

        {activeTab === 'settings' && (<Settings
          aiPreferences={aiPreferences} saving={settingsSaving} onSave={saveAiPreferences}
          personas={personas} onPersonasChange={loadPersonas} apiFetch={apiFetch}
          personaPreferences={personaPreferences} setPersonaPreferences={setPersonaPreferences}
        />)}
      </div>
    </div>
  );
}

// ============================================
// DASHBOARD COMPONENT — Expandable Watchlist
// ============================================
const IMPORTANT_TYPES = new Set(['10-K', '10-Q', '8-K', '6-K', '20-F', 'S-1', 'SC 13D', 'DEF 14A', '13F-HR']);
const INSIDER_TYPES = new Set(['4', '144']);

// "Big" insider trade = Form 4/144 where AI flagged high expected move or high confidence
function isBigInsider(f) {
  if (!INSIDER_TYPES.has(f.formType)) return false;
  const move = Math.abs(parseFloat(f.expected_move_avg) || 0);
  const conf = parseInt(f.confidence_score) || 0;
  return move >= 2 || conf >= 75;
}

function Dashboard({ dashboard, loading, sentiment, onRefresh, expandedTicker, toggleTicker, tickerFilings, tickerFilingsLoading, hideRead, setHideRead, markAsRead, markAsUnread, expandedFiling, setExpandedFiling, stockPrices, unreadFilter, setUnreadFilter, selectedFilings, toggleFilingSelection, toggleSelectAll, bulkMarkAsRead, bulkMarkAsUnread, typeFilter, setTypeFilter, reanalyzeFiling, reanalyzing }) {
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
            const typeFiltered = typeFilter === 'all' ? filings
              : typeFilter === 'important' ? filings.filter(f => IMPORTANT_TYPES.has(f.formType))
              : typeFilter === 'insider-big' ? filings.filter(f => isBigInsider(f))
              : typeFilter === 'insider-routine' ? filings.filter(f => INSIDER_TYPES.has(f.formType) && !isBigInsider(f))
              : filings;
            const visibleFilings = hideRead ? typeFiltered.filter(f => !f.read) : typeFiltered;
            const selected = selectedFilings[t.cik] || new Set();
            const selectedCount = [...selected].filter(an => visibleFilings.some(f => f.accessionNumber === an)).length;
            const allVisibleSelected = visibleFilings.length > 0 && visibleFilings.every(f => selected.has(f.accessionNumber));
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

                    {/* Filing type filter + bulk actions toolbar */}
                    {!isLoadingFilings && filings.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {[
                          { k: 'all', l: 'All' },
                          { k: 'important', l: '🔴 Important' },
                          { k: 'insider-big', l: '💰 Big Insider' },
                          { k: 'insider-routine', l: '👤 Routine Insider' }
                        ].map(f => (
                          <button key={f.k} onClick={(e) => { e.stopPropagation(); setTypeFilter(f.k); }}
                            style={{ padding: '0.3rem 0.75rem', borderRadius: '16px', fontSize: '0.8rem', cursor: 'pointer',
                              background: typeFilter === f.k ? '#667eea' : 'white', color: typeFilter === f.k ? 'white' : '#666',
                              border: `1px solid ${typeFilter === f.k ? '#667eea' : '#ddd'}` }}>
                            {f.l}
                          </button>
                        ))}
                        <span style={{ color: '#999', fontSize: '0.8rem', marginLeft: '0.25rem' }}>{visibleFilings.length} filing{visibleFilings.length !== 1 ? 's' : ''}</span>

                        {/* Select all + bulk actions (right side) */}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          {visibleFilings.length > 0 && (
                            <label onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', color: '#666' }}>
                              <input type="checkbox" checked={allVisibleSelected} onChange={() => toggleSelectAll(t.cik, visibleFilings)}
                                style={{ cursor: 'pointer' }} />
                              Select all
                            </label>
                          )}
                          {selectedCount > 0 && (<>
                            <button onClick={(e) => { e.stopPropagation(); bulkMarkAsRead(t.cik); }}
                              style={{ padding: '0.3rem 0.75rem', background: '#28a745', color: 'white', border: 'none',
                                borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: '500' }}>
                              ✓ Mark {selectedCount} read
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); bulkMarkAsUnread(t.cik); }}
                              style={{ padding: '0.3rem 0.75rem', background: '#667eea', color: 'white', border: 'none',
                                borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: '500' }}>
                              Mark {selectedCount} unread
                            </button>
                          </>)}
                        </div>
                      </div>
                    )}

                    {isLoadingFilings && (
                      <div style={{ textAlign: 'center', padding: '1.5rem', color: '#666' }}>Loading filings...</div>
                    )}
                    {!isLoadingFilings && visibleFilings.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '1.5rem', color: '#999', fontSize: '0.9rem' }}>
                        {hideRead && typeFiltered.length > 0 ? 'All filings marked as read. Toggle "Show all" to see them.'
                          : typeFilter !== 'all' && filings.length > 0 ? `No ${typeFilter === 'insider-big' ? 'big insider' : typeFilter === 'insider-routine' ? 'routine insider' : typeFilter} filings found. Try a different filter.`
                          : 'No filings in the last 90 days.'}
                      </div>
                    )}
                    {!isLoadingFilings && visibleFilings.map(f => {
                      const fs = sentiment(f.sentiment_direction);
                      const info = getFilingInfo(f.formType);
                      const has = f.ai_summary;
                      const isFilingExpanded = expandedFiling === f.accessionNumber;
                      const isSelected = selected.has(f.accessionNumber);

                      return (
                        <div key={f.accessionNumber} style={{
                          padding: '1rem', marginBottom: '0.5rem', borderRadius: '6px',
                          border: isSelected ? '1px solid #667eea' : f.read ? '1px solid #eee' : '1px solid #c5cdf5',
                          borderLeft: isSelected ? '3px solid #667eea' : f.read ? '3px solid #eee' : '3px solid #667eea',
                          background: isSelected ? '#f0f2ff' : f.read ? '#fafafa' : '#fdfdff',
                          opacity: f.read && !isSelected ? 0.7 : 1
                        }}>
                          {/* Filing header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flex: 1 }}>
                              {/* Checkbox */}
                              <input type="checkbox" checked={isSelected}
                                onChange={(e) => { e.stopPropagation(); toggleFilingSelection(t.cik, f.accessionNumber); }}
                                style={{ marginTop: '0.15rem', cursor: 'pointer', flexShrink: 0 }} />
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
                          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginLeft: '1.5rem' }}>
                            {!f.read && (
                              <button onClick={(e) => { e.stopPropagation(); markAsRead(f.accessionNumber, t.cik); }}
                                style={{ padding: '0.35rem 0.75rem', background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9',
                                  borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: '500' }}>
                                ✓ Mark read
                              </button>
                            )}
                            {f.read && (
                              <button onClick={(e) => { e.stopPropagation(); markAsUnread(f.accessionNumber, t.cik); }}
                                style={{ padding: '0.35rem 0.75rem', background: '#fff3e0', color: '#e65100', border: '1px solid #ffe0b2',
                                  borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: '500' }}>
                                Mark unread
                              </button>
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
                            <button onClick={(e) => { e.stopPropagation(); reanalyzeFiling(f.accessionNumber, t.cik); }}
                              disabled={reanalyzing[f.accessionNumber]}
                              style={{ padding: '0.35rem 0.75rem', background: reanalyzing[f.accessionNumber] ? '#e0e0e0' : '#f3e5f5',
                                color: reanalyzing[f.accessionNumber] ? '#999' : '#7b1fa2', border: '1px solid #ce93d8',
                                borderRadius: '4px', fontSize: '0.8rem', cursor: reanalyzing[f.accessionNumber] ? 'wait' : 'pointer', fontWeight: '500' }}>
                              {reanalyzing[f.accessionNumber] ? '⏳ Analysing...' : '🔄 Re-analyse'}
                            </button>
                          </div>

                          {/* Expanded full analysis */}
                          {isFilingExpanded && has && (() => {
                            const pro = f.pro_analysis;
                            if (pro) {
                              // Pro Analysis view
                              return (
                                <div style={{ marginTop: '0.75rem', marginLeft: '1.5rem' }}>
                                  {/* Analyst Note */}
                                  {pro.analyst_note && (
                                    <div style={{ padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '0.75rem' }}>
                                      <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '0.5rem', color: '#1a1a2e' }}>📝 Research Note</div>
                                      <div style={{ fontSize: '0.9rem', color: '#333', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>{pro.analyst_note}</div>
                                    </div>
                                  )}

                                  {/* KPI Grid */}
                                  {pro.kpis && Object.keys(pro.kpis).length > 0 && (
                                    <div style={{ padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '0.75rem' }}>
                                      <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '0.75rem', color: '#1a1a2e' }}>📊 Key Metrics</div>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
                                        {Object.entries(pro.kpis).filter(([k, v]) => v !== null && v !== undefined && k !== 'segments' && k !== 'new_metrics' && k !== 'key_terms' && k !== 'board_changes' && k !== 'key_proposals').map(([k, v]) => (
                                          <div key={k} style={{ padding: '0.5rem 0.75rem', background: '#f8f9fa', borderRadius: '6px', border: '1px solid #eee' }}>
                                            <div style={{ fontSize: '0.7rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.replace(/_/g, ' ')}</div>
                                            <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#1a1a2e', marginTop: '0.15rem' }}>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</div>
                                          </div>
                                        ))}
                                      </div>
                                      {/* Segments */}
                                      {pro.kpis.segments?.length > 0 && (
                                        <div style={{ marginTop: '0.75rem' }}>
                                          <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#555', marginBottom: '0.25rem' }}>Business Segments:</div>
                                          {pro.kpis.segments.map((s, i) => (
                                            <div key={i} style={{ fontSize: '0.85rem', color: '#333', marginLeft: '0.5rem' }}>
                                              {s.name}: {s.revenue}{s.growth ? ` (${s.growth})` : ''}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* The Desk — Persona Takes */}
                                  {pro.persona_takes?.length > 0 && (
                                    <div style={{ padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '0.75rem' }}>
                                      <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '0.75rem', color: '#1a1a2e' }}>🎙️ The Desk</div>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.5rem' }}>
                                        {pro.persona_takes.map((pt, i) => (
                                          <div key={i} style={{ padding: '0.75rem', background: '#f8f9fa', borderRadius: '6px', border: '1px solid #eee' }}>
                                            <div style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '0.35rem', color: '#1a1a2e' }}>
                                              {pt.emoji} {pt.name}
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: '#444', lineHeight: '1.5', fontStyle: 'italic' }}>"{pt.take}"</div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Bullish / Bearish columns */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                    {f.bullish_factors?.length > 0 && (
                                      <div style={{ padding: '0.75rem', background: '#f0fff4', borderRadius: '8px', border: '1px solid #c6f6d5' }}>
                                        <div style={{ fontWeight: '700', color: '#22543d', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⬆️ Bullish ({f.bullish_factors.length})</div>
                                        {f.bullish_factors.map((x, i) => <div key={i} style={{ fontSize: '0.82rem', color: '#2d3748', marginBottom: '0.35rem', paddingLeft: '0.5rem', borderLeft: '2px solid #48bb78' }}>{x}</div>)}
                                      </div>
                                    )}
                                    {f.bearish_factors?.length > 0 && (
                                      <div style={{ padding: '0.75rem', background: '#fff5f5', borderRadius: '8px', border: '1px solid #fed7d7' }}>
                                        <div style={{ fontWeight: '700', color: '#742a2a', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⬇️ Bearish ({f.bearish_factors.length})</div>
                                        {f.bearish_factors.map((x, i) => <div key={i} style={{ fontSize: '0.82rem', color: '#2d3748', marginBottom: '0.35rem', paddingLeft: '0.5rem', borderLeft: '2px solid #fc8181' }}>{x}</div>)}
                                      </div>
                                    )}
                                  </div>

                                  {/* Management Signals */}
                                  {pro.management_signals && (pro.management_signals.tone || pro.management_signals.guidance_direction || pro.management_signals.key_quote) && (
                                    <div style={{ padding: '0.75rem', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '0.75rem' }}>
                                      <div style={{ fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.5rem', color: '#1a1a2e' }}>🎯 Management Signals</div>
                                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                                        {pro.management_signals.tone && <span><strong>Tone:</strong> {pro.management_signals.tone}</span>}
                                        {pro.management_signals.guidance_direction && <span><strong>Guidance:</strong> {pro.management_signals.guidance_direction}</span>}
                                        {pro.management_signals.buyback_announced && <span>💰 Buyback announced</span>}
                                        {pro.management_signals.insider_buying && <span>📈 Insider buying</span>}
                                      </div>
                                      {pro.management_signals.key_quote && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#555', fontStyle: 'italic', borderLeft: '3px solid #667eea', paddingLeft: '0.75rem' }}>
                                          "{pro.management_signals.key_quote}"
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Action Items */}
                                  {pro.action_items?.length > 0 && (
                                    <div style={{ padding: '0.75rem', background: '#fffff0', borderRadius: '8px', border: '1px solid #fefcbf', marginBottom: '0.75rem' }}>
                                      <div style={{ fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.5rem', color: '#744210' }}>👀 What to Watch</div>
                                      {pro.action_items.map((item, i) => (
                                        <div key={i} style={{ fontSize: '0.85rem', color: '#2d3748', marginBottom: '0.25rem', paddingLeft: '0.5rem' }}>📌 {item}</div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Summary strip: Direction + Expected + Confidence */}
                                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', padding: '0.75rem', background: '#f8f9fa', borderRadius: '6px', border: '1px solid #eee', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                                    <span><strong>Direction:</strong> {fs.emoji} {fs.text}</span>
                                    <span><strong>Expected:</strong> {f.expected_move_min}% to {f.expected_move_max}% (avg {f.expected_move_avg}%)</span>
                                    <span><strong>Confidence:</strong> {f.confidence_score}%</span>
                                  </div>

                                  {/* AI Consensus + Short Interest */}
                                  {f.ai_consensus?.analyses && (
                                    <div style={{ padding: '0.75rem', background: 'white', borderRadius: '6px', border: '1px solid #e0e0e0', marginBottom: '0.5rem' }}>
                                      <div style={{ fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>AI Consensus ({f.ai_consensus.provider_count} models):</div>
                                      {f.ai_consensus.analyses.map((a, i) => (
                                        <div key={i} style={{ fontSize: '0.85rem', color: '#555' }}>
                                          {a.provider}: {a.sentiment === 'bullish' ? '⬆️' : a.sentiment === 'bearish' ? '⬇️' : '➡️'} {a.expected_move > 0 ? '+' : ''}{a.expected_move}% ({a.confidence}%)
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {f.short_interest_percent && (
                                    <div style={{ padding: '0.75rem', background: 'white', borderRadius: '6px', border: '1px solid #e0e0e0' }}>
                                      <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>Short Interest: {f.short_interest_percent}%{f.short_interest_percent > 15 ? ' 🚀' : ''}</div>
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            // Legacy simple view (no pro_analysis)
                            return (
                              <div style={{ marginTop: '0.75rem', padding: '1rem', background: '#f8f9fa', borderRadius: '6px', borderTop: '1px solid #eee', marginLeft: '1.5rem' }}>
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
                            );
                          })()}
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
function Settings({ aiPreferences, saving, onSave, personas, onPersonasChange, apiFetch, personaPreferences, setPersonaPreferences }) {
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [editingPersona, setEditingPersona] = useState(null);
  const [personaForm, setPersonaForm] = useState({ name: '', short_name: '', emoji: '', framework: '', key_metrics: '', style: '' });
  const [personaSaving, setPersonaSaving] = useState(false);

  const models = [
    { key: 'claude', name: 'Anthropic Claude Sonnet 4', desc: 'Nuanced insights and detailed reasoning.', cost: '~$0.018/filing', badge: 'PAID', badgeColor: '#ffc107' },
    { key: 'grok', name: 'xAI Grok 3', desc: 'Fast analysis with trading focus.', cost: '~$0.001/filing', badge: 'PAID', badgeColor: '#ffc107' },
    { key: 'gemini', name: 'Google Gemini 1.5 Pro', desc: 'Fast and accurate financial analysis.', cost: 'Free tier available', badge: 'FREE', badgeColor: '#28a745' },
  ];

  // Check if a persona is active for this user
  const isPersonaActive = (shortName) => {
    if (!personaPreferences) return true; // null = all active by default
    return personaPreferences[shortName] !== false;
  };

  const resetForm = () => {
    setPersonaForm({ name: '', short_name: '', emoji: '', framework: '', key_metrics: '', style: '' });
    setShowAddPersona(false);
    setEditingPersona(null);
  };

  const savePersona = async () => {
    setPersonaSaving(true);
    try {
      const body = {
        ...personaForm,
        key_metrics: typeof personaForm.key_metrics === 'string'
          ? personaForm.key_metrics.split(',').map(s => s.trim()).filter(Boolean)
          : personaForm.key_metrics
      };

      if (editingPersona) {
        await apiFetch(`/api/personas/${editingPersona}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        // Create persona globally, then auto-enable for this user
        await apiFetch('/api/personas', { method: 'POST', body: JSON.stringify(body) });
        const shortName = body.short_name || personaForm.short_name.toLowerCase().replace(/\s+/g, '_');
        const newPrefs = { ...(personaPreferences || {}), [shortName]: true };
        await apiFetch('/api/preferences', { method: 'PUT', body: JSON.stringify({ personaPreferences: newPrefs }) });
        setPersonaPreferences(newPrefs);
      }
      resetForm();
      onPersonasChange();
    } catch (e) { console.error('Save persona error:', e); }
    finally { setPersonaSaving(false); }
  };

  // Toggle persona for THIS USER (saves to user's persona_preferences, not global)
  const togglePersona = async (shortName, currentlyActive) => {
    try {
      const newPrefs = { ...(personaPreferences || {}) };
      newPrefs[shortName] = !currentlyActive;
      await apiFetch('/api/preferences', { method: 'PUT', body: JSON.stringify({ personaPreferences: newPrefs }) });
      setPersonaPreferences(newPrefs);
    } catch (e) { console.error('Toggle persona error:', e); }
  };

  const startEdit = (p) => {
    setEditingPersona(p.id);
    setPersonaForm({
      name: p.name,
      short_name: p.short_name,
      emoji: p.emoji || '',
      framework: p.framework,
      key_metrics: Array.isArray(p.key_metrics) ? p.key_metrics.join(', ') : p.key_metrics,
      style: p.style
    });
    setShowAddPersona(true);
  };

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
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
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

      {/* Analyst Personas */}
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Your Analysts</h3>
          <button onClick={() => { resetForm(); setShowAddPersona(true); }}
            style={{ padding: '0.5rem 1rem', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500' }}>
            + Add Analyst
          </button>
        </div>
        <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0, marginBottom: '1rem' }}>
          Each analyst brings their own framework and style. Toggle them on/off for your analyses — this only affects your account.
          New analysts you create are available to all users.
        </p>

        {/* Persona cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
          {personas.map(p => {
            const active = isPersonaActive(p.short_name);
            return (
              <div key={p.id} style={{
                padding: '1rem', borderRadius: '8px',
                border: active ? '2px solid #667eea' : '2px solid #ddd',
                background: active ? '#f8f9ff' : '#fafafa',
                opacity: active ? 1 : 0.6,
                transition: 'all 0.2s'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '1rem' }}>{p.emoji} {p.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.1rem' }}>{p.short_name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button onClick={() => togglePersona(p.short_name, active)}
                      style={{ padding: '0.25rem 0.5rem', background: active ? '#e8f5e9' : '#fff3e0', color: active ? '#2e7d32' : '#e65100',
                        border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '500' }}>
                      {active ? 'On' : 'Off'}
                    </button>
                    <button onClick={() => startEdit(p)}
                      style={{ padding: '0.25rem 0.5rem', background: '#e3f2fd', color: '#1565c0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                      Edit
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.5rem', lineHeight: '1.4' }}>
                  <strong>Framework:</strong> {p.framework.length > 120 ? p.framework.substring(0, 120) + '...' : p.framework}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.25rem' }}>
                  <strong>Style:</strong> {p.style.length > 80 ? p.style.substring(0, 80) + '...' : p.style}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add/Edit Persona Form */}
        {showAddPersona && (
          <div style={{ marginTop: '1rem', padding: '1.25rem', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
            <h4 style={{ margin: '0 0 1rem 0' }}>{editingPersona ? 'Edit Analyst' : 'Add New Analyst'}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Name *</label>
                <input value={personaForm.name} onChange={e => setPersonaForm({ ...personaForm, name: e.target.value })}
                  placeholder="e.g. Peter Lynch"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Short Name *</label>
                  <input value={personaForm.short_name} onChange={e => setPersonaForm({ ...personaForm, short_name: e.target.value })}
                    placeholder="e.g. lynch" disabled={!!editingPersona}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                </div>
                <div style={{ width: '60px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Emoji</label>
                  <input value={personaForm.emoji} onChange={e => setPersonaForm({ ...personaForm, emoji: e.target.value })}
                    placeholder="📈" maxLength={4}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem', boxSizing: 'border-box', textAlign: 'center' }} />
                </div>
              </div>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Analytical Framework *</label>
              <textarea value={personaForm.framework} onChange={e => setPersonaForm({ ...personaForm, framework: e.target.value })}
                placeholder="Describe their investment philosophy and analytical approach. E.g. 'Growth at a reasonable price (GARP), looks for companies with strong earnings growth trading at reasonable PE multiples...'"
                rows={3}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.85rem', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Key Metrics (comma separated) *</label>
              <input value={personaForm.key_metrics} onChange={e => setPersonaForm({ ...personaForm, key_metrics: e.target.value })}
                placeholder="e.g. PEG ratio, earnings growth rate, ROE, debt-to-equity"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.85rem', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Communication Style *</label>
              <input value={personaForm.style} onChange={e => setPersonaForm({ ...personaForm, style: e.target.value })}
                placeholder="e.g. Folksy, uses real-world analogies, 'invest in what you know'"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.85rem', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button onClick={savePersona} disabled={personaSaving || !personaForm.name || !personaForm.framework || !personaForm.key_metrics || !personaForm.style}
                style={{ padding: '0.5rem 1.25rem', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500',
                  opacity: (personaSaving || !personaForm.name || !personaForm.framework || !personaForm.key_metrics || !personaForm.style) ? 0.5 : 1 }}>
                {personaSaving ? 'Saving...' : editingPersona ? 'Update Analyst' : 'Add Analyst'}
              </button>
              <button onClick={resetForm}
                style={{ padding: '0.5rem 1.25rem', background: 'white', color: '#666', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
