import React, { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'https://sec-filings-tracker-production.up.railway.app';

// Icons
const icons = {
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', top: '12px', color: '#9ca3af' }}>
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  x: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  chevronDown: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  chevronUp: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
  external: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  ),
};

function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // App state
  const [activeTab, setActiveTab] = useState('watchlist');
  const [watchlist, setWatchlist] = useState([]);
  
  // Search state (for watchlist autocomplete)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Filings state
  const [filings, setFilings] = useState([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [filingsError, setFilingsError] = useState('');
  const [daysBack, setDaysBack] = useState(7);
  const [filingsSearchQuery, setFilingsSearchQuery] = useState('');
  const [expandedFiling, setExpandedFiling] = useState(null);

  // Settings state
  const [aiPreferences, setAiPreferences] = useState({ 
    claude: false, 
    gemini: true, 
    grok: false 
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Check authentication on mount
  useEffect(() => {
    const token = localStorage.getItem('sec_token');
    if (token) {
      setIsAuthenticated(true);
      loadWatchlist();
    }
  }, []);

  // Load watchlist
  const loadWatchlist = async () => {
    try {
      const token = localStorage.getItem('sec_token');
      const response = await fetch(`${API_URL}/api/watchlist`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (response.ok) {
        setWatchlist(data);
      }
    } catch (err) {
      console.error('Watchlist error:', err);
    }
  };

  // Search companies with debounce (for watchlist autocomplete)
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const timer = setTimeout(async () => {
      if (searchQuery.length > 0) {
        try {
          const token = localStorage.getItem('sec_token');
          const response = await fetch(`${API_URL}/api/sec/search?query=${encodeURIComponent(searchQuery)}`, {
            headers: { 
              'Content-Type': 'application/json', 
              'Authorization': `Bearer ${token}` 
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            setSearchResults(data);
          } else {
            setSearchResults([]);
          }
        } catch (err) { 
          console.error('Search error:', err); 
          setSearchResults([]); 
        }
      } else {
        setSearchResults([]);
      }
    }, 400);
    
    return () => clearTimeout(timer);
  }, [searchQuery, isAuthenticated]);

  // Load filings
  const loadFilings = useCallback(async () => {
    setFilingsLoading(true);
    setFilingsError('');
    try {
      const token = localStorage.getItem('sec_token');
      const response = await fetch(`${API_URL}/api/sec/filings?daysBack=${daysBack}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (response.ok) {
        setFilings(data);
      } else {
        setFilingsError(data.error || 'Failed to load filings');
      }
    } catch (err) {
      setFilingsError('Network error loading filings');
      console.error('Filings error:', err);
    } finally {
      setFilingsLoading(false);
    }
  }, [daysBack]);

  // Load filings when watchlist or days back changes
  useEffect(() => {
    if (isAuthenticated && watchlist.length > 0 && activeTab === 'filings') {
      loadFilings();
    }
  }, [watchlist, daysBack, activeTab, isAuthenticated, loadFilings]);

  // Load user preferences on mount
  useEffect(() => {
    if (isAuthenticated) {
      const fetchPreferences = async () => {
        try {
          const token = localStorage.getItem('sec_token');
          const response = await fetch(`${API_URL}/api/preferences`, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            }
          });
          const data = await response.json();
          if (data.ai_preferences) {
            setAiPreferences(data.ai_preferences);
          }
        } catch (err) {
          console.error('Load preferences error:', err);
        }
      };
      fetchPreferences();
    }
  }, [isAuthenticated]);

  // Auth handlers
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('sec_token', data.token);
        setIsAuthenticated(true);
        setEmail('');
        setPassword('');
        loadWatchlist();
      } else {
        setAuthError(data.error || 'Authentication failed');
      }
    } catch (err) {
      setAuthError('Network error. Please try again.');
      console.error('Auth error:', err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('sec_token');
    setIsAuthenticated(false);
    setWatchlist([]);
    setFilings([]);
    setActiveTab('watchlist');
  };

  // Watchlist handlers
  const addToWatchlist = async (entity) => {
    try {
      const token = localStorage.getItem('sec_token');
      await fetch(`${API_URL}/api/watchlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(entity)
      });
      setSearchQuery('');
      setSearchResults([]);
      await loadWatchlist();
    } catch (err) {
      console.error('Add error:', err);
    }
  };

  const removeFromWatchlist = async (cik) => {
    try {
      const token = localStorage.getItem('sec_token');
      await fetch(`${API_URL}/api/watchlist/${cik}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      await loadWatchlist();
    } catch (err) {
      console.error('Remove error:', err);
    }
  };

  // Save AI preferences
  const saveAiPreferences = async (newPrefs) => {
    setSettingsSaving(true);
    try {
      const token = localStorage.getItem('sec_token');
      await fetch(`${API_URL}/api/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ aiPreferences: newPrefs })
      });
      setAiPreferences(newPrefs);
      if (watchlist.length > 0 && activeTab === 'filings') {
        await loadFilings();
      }
    } catch (err) {
      console.error('Save preferences error:', err);
    } finally {
      setSettingsSaving(false);
    }
  };

  // Search filings (filter local results)
  const filteredFilings = filings.filter(filing => {
    if (!filingsSearchQuery) return true;
    const query = filingsSearchQuery.toLowerCase();
    return (
      filing.company?.toLowerCase().includes(query) ||
      filing.formType?.toLowerCase().includes(query) ||
      filing.ticker?.toLowerCase().includes(query) ||
      filing.description?.toLowerCase().includes(query)
    );
  });

  // Get sentiment display
  const getSentimentDisplay = (sentiment) => {
    if (!sentiment) return { emoji: '➡️', text: 'NEUTRAL', color: '#666' };
    
    const upper = sentiment.toUpperCase();
    if (upper === 'BULLISH') return { emoji: '⬆️', text: 'BULLISH', color: '#28a745' };
    if (upper === 'BEARISH') return { emoji: '⬇️', text: 'BEARISH', color: '#dc3545' };
    return { emoji: '➡️', text: 'NEUTRAL', color: '#666' };
  };

  // Get priority badge
  const getPriorityBadge = (priority) => {
    if (!priority) return '⚪';
    const level = priority.level || 'low';
    if (level === 'high') return '🔴';
    if (level === 'medium') return '🟡';
    return '🟢';
  };

  // Toggle filing expansion
  const toggleFiling = (filingId) => {
    setExpandedFiling(expandedFiling === filingId ? null : filingId);
  };

  // Login/Register screen
  if (!isAuthenticated) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          background: 'white',
          padding: '2rem',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          width: '100%',
          maxWidth: '400px'
        }}>
          <h1 style={{ marginBottom: '1.5rem', textAlign: 'center', color: '#333' }}>
            SEC Filings Tracker
          </h1>
          <form onSubmit={handleAuth}>
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            {authError && (
              <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>
                {authError}
              </div>
            )}
            <button
              type="submit"
              disabled={authLoading}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '1rem',
                cursor: authLoading ? 'not-allowed' : 'pointer',
                marginBottom: '1rem'
              }}
            >
              {authLoading ? 'Loading...' : (isLogin ? 'Login' : 'Register')}
            </button>
          </form>
          <button
            onClick={() => setIsLogin(!isLogin)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: 'transparent',
              color: '#667eea',
              border: '1px solid #667eea',
              borderRadius: '4px',
              fontSize: '1rem',
              cursor: 'pointer'
            }}
          >
            {isLogin ? 'Need an account? Register' : 'Have an account? Login'}
          </button>
        </div>
      </div>
    );
  }

  // Main app
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{
        background: 'white',
        padding: '1rem 2rem',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ margin: 0, color: '#333' }}>SEC Filings Tracker</h1>
        <button
          onClick={handleLogout}
          style={{
            padding: '0.5rem 1rem',
            background: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Logout
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        background: 'white',
        padding: '0 2rem',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
        display: 'flex',
        gap: '1rem'
      }}>
        <button
          onClick={() => setActiveTab('watchlist')}
          style={{
            padding: '1rem 1.5rem',
            background: activeTab === 'watchlist' ? '#667eea' : 'transparent',
            color: activeTab === 'watchlist' ? 'white' : '#666',
            border: 'none',
            borderBottom: activeTab === 'watchlist' ? '3px solid #667eea' : '3px solid transparent',
            cursor: 'pointer',
            fontWeight: '500'
          }}
        >
          Watchlist ({watchlist.length})
        </button>
        <button
          onClick={() => setActiveTab('filings')}
          style={{
            padding: '1rem 1.5rem',
            background: activeTab === 'filings' ? '#667eea' : 'transparent',
            color: activeTab === 'filings' ? 'white' : '#666',
            border: 'none',
            borderBottom: activeTab === 'filings' ? '3px solid #667eea' : '3px solid transparent',
            cursor: 'pointer',
            fontWeight: '500'
          }}
        >
          Filings ({filings.length})
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          style={{
            padding: '1rem 1.5rem',
            background: activeTab === 'settings' ? '#667eea' : 'transparent',
            color: activeTab === 'settings' ? 'white' : '#666',
            border: 'none',
            borderBottom: activeTab === 'settings' ? '3px solid #667eea' : '3px solid transparent',
            cursor: 'pointer',
            fontWeight: '500'
          }}
        >
          Settings
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* Watchlist Tab */}
        {activeTab === 'watchlist' && (
          <div>
            <h2 style={{ marginBottom: '1rem' }}>Your Watchlist</h2>
            
            {/* Search with autocomplete */}
            <div style={{ marginBottom: '2rem', position: 'relative' }}>
              {icons.search}
              <input
                type="text"
                placeholder="Search companies or tickers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: '40px',
                  paddingRight: '16px',
                  paddingTop: '12px',
                  paddingBottom: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
              
              {/* Autocomplete dropdown */}
              {searchResults.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '8px',
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  maxHeight: '250px',
                  overflowY: 'auto',
                  zIndex: 10
                }}>
                  {searchResults.map((result) => (
                    <div
                      key={result.cik}
                      onClick={() => addToWatchlist(result)}
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                      <div style={{ fontWeight: '600', color: '#111827', fontSize: '14px' }}>
                        {result.name}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '2px' }}>
                        {result.ticker} • CIK: {result.cik}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Watchlist items */}
            {watchlist.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '2rem', 
                background: 'white', 
                borderRadius: '8px',
                color: '#666'
              }}>
                No companies in watchlist. Search and add some to get started!
              </div>
            ) : (
              <div style={{ 
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {watchlist.map((entity) => (
                  <div
                    key={entity.cik}
                    style={{
                      background: 'white',
                      padding: '16px',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '600', color: '#111827', fontSize: '15px' }}>
                        {entity.name}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: '13px' }}>
                        {entity.ticker}
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromWatchlist(entity.cik)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#ef4444',
                        padding: '8px'
                      }}
                    >
                      {icons.x}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filings Tab */}
        {activeTab === 'filings' && (
          <div>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '1rem',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <h2 style={{ margin: 0 }}>Recent Filings</h2>
              
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label>Days back:</label>
                <select
                  value={daysBack}
                  onChange={(e) => setDaysBack(Number(e.target.value))}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
                <button
                  onClick={loadFilings}
                  disabled={filingsLoading}
                  style={{
                    padding: '0.5rem 1rem',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: filingsLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {filingsLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
            </div>

            {/* Search box for filings */}
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                placeholder="Search by ticker, form type, or company name..."
                value={filingsSearchQuery}
                onChange={(e) => setFilingsSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {filingsError && (
              <div style={{ 
                padding: '1rem', 
                background: '#f8d7da', 
                color: '#721c24', 
                borderRadius: '4px',
                marginBottom: '1rem'
              }}>
                {filingsError}
              </div>
            )}

            {watchlist.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '2rem', 
                background: 'white', 
                borderRadius: '8px',
                color: '#666'
              }}>
                Add companies to your watchlist to see their filings.
              </div>
            ) : filingsLoading ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '2rem', 
                background: 'white', 
                borderRadius: '8px',
                color: '#666'
              }}>
                Loading filings...
              </div>
            ) : filteredFilings.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '2rem', 
                background: 'white', 
                borderRadius: '8px',
                color: '#666'
              }}>
                {filingsSearchQuery ? 'No filings match your search.' : 'No recent filings found for your watchlist.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredFilings.map((filing) => {
                  const isExpanded = expandedFiling === filing.accessionNumber;
                  const sentiment = getSentimentDisplay(filing.sentiment_direction);
                  const priorityBadge = getPriorityBadge(filing.priority);
                  const hasAnalysis = filing.ai_summary;
                  
                  return (
                    <div
                      key={filing.accessionNumber || filing.id}
                      style={{
                        background: 'white',
                        borderRadius: '8px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        overflow: 'hidden'
                      }}
                    >
                      {/* Collapsed View */}
                      <div style={{ padding: '1.5rem' }}>
                        {/* Header with sentiment badge */}
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'flex-start',
                          marginBottom: '0.75rem',
                          flexWrap: 'wrap',
                          gap: '0.5rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                            <span style={{ fontSize: '1.2rem' }}>{priorityBadge}</span>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                                  {filing.company || 'Unknown Company'}
                                </span>
                                <span style={{ 
                                  padding: '0.25rem 0.5rem',
                                  background: '#667eea',
                                  color: 'white',
                                  borderRadius: '4px',
                                  fontSize: '0.85rem',
                                  fontWeight: '500'
                                }}>
                                  {filing.formType}
                                </span>
                              </div>
                              <div style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                                {filing.description} • Filed: {filing.filedDate ? new Date(filing.filedDate).toLocaleDateString() : 'Date unavailable'}
                              </div>
                            </div>
                          </div>
                          
                          {/* Sentiment Badge */}
                          {hasAnalysis && filing.expected_move_avg && (
                            <div style={{ 
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-end',
                              minWidth: '120px'
                            }}>
                              <div style={{ 
                                fontSize: '1.2rem',
                                fontWeight: 'bold',
                                color: sentiment.color,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}>
                                {sentiment.emoji} {filing.expected_move_avg > 0 ? '+' : ''}{filing.expected_move_avg}%
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#666' }}>
                                ({filing.confidence_score}% sure)
                              </div>
                            </div>
                          )}
                        </div>

                        {/* AI Summary (if available) */}
                        {hasAnalysis && (
                          <div style={{ 
                            marginTop: '0.75rem',
                            padding: '0.75rem',
                            background: '#f8f9fa',
                            borderRadius: '4px',
                            borderLeft: `4px solid ${sentiment.color}`
                          }}>
                            <div style={{ fontSize: '0.95rem', lineHeight: '1.5', color: '#333' }}>
                              🤖 {filing.ai_summary}
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div style={{ 
                          marginTop: '1rem',
                          display: 'flex',
                          gap: '0.5rem',
                          flexWrap: 'wrap'
                        }}>
                          <a
                            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=${filing.formType}&dateb=&owner=exclude&count=40`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '0.5rem 1rem',
                              background: '#667eea',
                              color: 'white',
                              textDecoration: 'none',
                              borderRadius: '4px',
                              fontSize: '0.9rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            View Filing {icons.external}
                          </a>
                          
                          {hasAnalysis && (
                            <button
                              onClick={() => toggleFiling(filing.accessionNumber)}
                              style={{
                                padding: '0.5rem 1rem',
                                background: 'white',
                                color: '#667eea',
                                border: '2px solid #667eea',
                                borderRadius: '4px',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                            >
                              📊 Full Analysis {isExpanded ? icons.chevronUp : icons.chevronDown}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded View */}
                      {isExpanded && hasAnalysis && (
                        <div style={{ 
                          padding: '1.5rem',
                          borderTop: '2px solid #f0f0f0',
                          background: '#fafafa'
                        }}>
                          {/* What It Means For Stock Price */}
                          <div style={{ marginBottom: '1.5rem' }}>
                            <h3 style={{ 
                              margin: '0 0 1rem 0',
                              fontSize: '1.1rem',
                              color: '#333',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem'
                            }}>
                              💡 What It Means For Stock Price
                            </h3>
                            
                            <div style={{ marginBottom: '1rem' }}>
                              <div style={{ marginBottom: '0.5rem' }}>
                                <strong>Direction:</strong> {sentiment.emoji} {sentiment.text}
                              </div>
                              <div style={{ marginBottom: '0.5rem' }}>
                                <strong>Expected Move:</strong> {filing.expected_move_min}% to {filing.expected_move_max}% 
                                (avg: {filing.expected_move_avg}%)
                              </div>
                              <div>
                                <strong>Confidence:</strong> {filing.confidence_score}%
                              </div>
                            </div>

                            {/* Bullish Factors */}
                            {filing.bullish_factors && filing.bullish_factors.length > 0 && (
                              <div style={{ marginBottom: '0.75rem' }}>
                                <div style={{ fontWeight: '600', color: '#28a745', marginBottom: '0.5rem' }}>
                                  Why bullish:
                                </div>
                                <ul style={{ margin: '0', paddingLeft: '1.5rem', color: '#333' }}>
                                  {filing.bullish_factors.map((factor, idx) => (
                                    <li key={idx} style={{ marginBottom: '0.25rem' }}>• {factor}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Bearish Factors */}
                            {filing.bearish_factors && filing.bearish_factors.length > 0 && (
                              <div style={{ marginBottom: '0.75rem' }}>
                                <div style={{ fontWeight: '600', color: '#dc3545', marginBottom: '0.5rem' }}>
                                  Risks/concerns:
                                </div>
                                <ul style={{ margin: '0', paddingLeft: '1.5rem', color: '#333' }}>
                                  {filing.bearish_factors.map((factor, idx) => (
                                    <li key={idx} style={{ marginBottom: '0.25rem' }}>• {factor}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* AI Consensus */}
                            {filing.ai_consensus && filing.ai_consensus.analyses && (
                              <div style={{ 
                                marginTop: '1rem',
                                padding: '0.75rem',
                                background: 'white',
                                borderRadius: '4px',
                                border: '1px solid #e0e0e0'
                              }}>
                                <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
                                  AI Consensus ({filing.ai_consensus.provider_count} models):
                                </div>
                                {filing.ai_consensus.analyses.map((analysis, idx) => (
                                  <div key={idx} style={{ 
                                    fontSize: '0.9rem',
                                    marginBottom: '0.25rem',
                                    color: '#555'
                                  }}>
                                    ├─ {analysis.provider}: {analysis.sentiment === 'bullish' ? '⬆️' : analysis.sentiment === 'bearish' ? '⬇️' : '➡️'} 
                                    {analysis.expected_move > 0 ? '+' : ''}{analysis.expected_move}% 
                                    ({analysis.confidence}% confident)
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Trading Opportunity */}
                          {(filing.short_interest_percent || filing.insider_activity) && (
                            <div>
                              <h3 style={{ 
                                margin: '0 0 1rem 0',
                                fontSize: '1.1rem',
                                color: '#333',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                              }}>
                                🎯 Trading Opportunity
                              </h3>

                              {filing.short_interest_percent && (
                                <div style={{ 
                                  padding: '0.75rem',
                                  background: 'white',
                                  borderRadius: '4px',
                                  marginBottom: '0.75rem',
                                  border: '1px solid #e0e0e0'
                                }}>
                                  <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
                                    Short Interest: {filing.short_interest_percent}%
                                    {filing.short_interest_percent > 15 && ' 🚀'}
                                  </div>
                                  <div style={{ fontSize: '0.9rem', color: '#555' }}>
                                    {filing.short_interest_percent > 20 && '→ Very high short interest - major squeeze potential'}
                                    {filing.short_interest_percent > 15 && filing.short_interest_percent <= 20 && '→ High short interest - squeeze potential on catalyst'}
                                    {filing.short_interest_percent > 10 && filing.short_interest_percent <= 15 && '→ Moderate short interest'}
                                    {filing.short_interest_percent <= 10 && '→ Low to moderate short interest'}
                                  </div>
                                  {sentiment.text === 'BULLISH' && filing.short_interest_percent > 15 && (
                                    <div style={{ 
                                      marginTop: '0.5rem',
                                      padding: '0.5rem',
                                      background: '#fff3cd',
                                      borderRadius: '4px',
                                      fontSize: '0.9rem',
                                      color: '#856404'
                                    }}>
                                      🚀 SETUP: Positive catalyst + high shorts = potential squeeze
                                    </div>
                                  )}
                                </div>
                              )}
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
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div>
            <h2 style={{ marginBottom: '1rem' }}>Settings</h2>
            
            <div style={{
              background: 'white',
              padding: '1.5rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>AI Analysis Preferences</h3>
              <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                Select which AI models to use for analyzing SEC filings. Each model provides unique insights,
                but enabling multiple models will increase processing time and cost.
              </p>

              {/* AI Model Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                {/* Gemini */}
                <div style={{
                  padding: '1rem',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  background: aiPreferences.gemini ? '#f0f7ff' : 'white',
                  borderColor: aiPreferences.gemini ? '#667eea' : '#ddd'
                }}>
                  <input
                    type="checkbox"
                    checked={aiPreferences.gemini}
                    onChange={(e) => saveAiPreferences({ ...aiPreferences, gemini: e.target.checked })}
                    disabled={settingsSaving}
                    style={{ marginTop: '0.25rem', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                      Google Gemini 1.5 Pro
                      <span style={{ 
                        marginLeft: '0.5rem',
                        padding: '0.25rem 0.5rem',
                        background: '#28a745',
                        color: 'white',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'normal'
                      }}>
                        FREE
                      </span>
                    </div>
                    <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                      Fast and accurate analysis with excellent financial understanding.
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#888' }}>
                      Cost: Free tier available (60 requests/min)
                    </div>
                  </div>
                </div>

                {/* Claude */}
                <div style={{
                  padding: '1rem',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  background: aiPreferences.claude ? '#f0f7ff' : 'white',
                  borderColor: aiPreferences.claude ? '#667eea' : '#ddd'
                }}>
                  <input
                    type="checkbox"
                    checked={aiPreferences.claude}
                    onChange={(e) => saveAiPreferences({ ...aiPreferences, claude: e.target.checked })}
                    disabled={settingsSaving}
                    style={{ marginTop: '0.25rem', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                      Anthropic Claude Sonnet 4.5
                      <span style={{ 
                        marginLeft: '0.5rem',
                        padding: '0.25rem 0.5rem',
                        background: '#ffc107',
                        color: '#333',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'normal'
                      }}>
                        PAID
                      </span>
                    </div>
                    <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                      Comprehensive analysis with nuanced insights and detailed reasoning.
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#888' }}>
                      Cost: ~$0.003 per filing (input) + ~$0.015 per filing (output)
                    </div>
                  </div>
                </div>

                {/* Grok */}
                <div style={{
                  padding: '1rem',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  background: aiPreferences.grok ? '#f0f7ff' : 'white',
                  borderColor: aiPreferences.grok ? '#667eea' : '#ddd'
                }}>
                  <input
                    type="checkbox"
                    checked={aiPreferences.grok}
                    onChange={(e) => saveAiPreferences({ ...aiPreferences, grok: e.target.checked })}
                    disabled={settingsSaving}
                    style={{ marginTop: '0.25rem', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                      xAI Grok Beta
                      <span style={{ 
                        marginLeft: '0.5rem',
                        padding: '0.25rem 0.5rem',
                        background: '#ffc107',
                        color: '#333',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'normal'
                      }}>
                        PAID
                      </span>
                    </div>
                    <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                      Real-time market context and trading-focused analysis.
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#888' }}>
                      Cost: ~$0.005 per filing (input) + ~$0.015 per filing (output)
                    </div>
                  </div>
                </div>
              </div>

              {/* Cost Estimate */}
              <div style={{
                padding: '1rem',
                background: '#f8f9fa',
                borderRadius: '4px',
                marginTop: '1.5rem'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                  Estimated Cost per Filing:
                </div>
                <div style={{ fontSize: '0.95rem', color: '#666' }}>
                  {(() => {
                    const enabledModels = [];
                    if (aiPreferences.gemini) enabledModels.push('Gemini (Free)');
                    if (aiPreferences.claude) enabledModels.push('Claude (~$0.018)');
                    if (aiPreferences.grok) enabledModels.push('Grok (~$0.020)');
                    
                    if (enabledModels.length === 0) {
                      return 'No AI models selected - filings will not be analyzed';
                    }
                    
                    let totalCost = 0;
                    if (aiPreferences.claude) totalCost += 0.018;
                    if (aiPreferences.grok) totalCost += 0.020;
                    
                    return (
                      <div>
                        <div>Selected: {enabledModels.join(', ')}</div>
                        <div style={{ marginTop: '0.25rem', fontWeight: 'bold', color: '#333' }}>
                          Total: {totalCost > 0 ? `~$${totalCost.toFixed(3)} per filing` : 'Free'}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Save Status */}
              {settingsSaving && (
                <div style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  background: '#d1ecf1',
                  color: '#0c5460',
                  borderRadius: '4px',
                  fontSize: '0.9rem'
                }}>
                  Saving preferences...
                </div>
              )}
            </div>

            {/* API Keys Status */}
            <div style={{
              background: 'white',
              padding: '1.5rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>API Keys Status</h3>
              <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.95rem' }}>
                API keys are configured in the backend environment variables. Contact your administrator
                to enable additional AI models.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#28a745'
                  }} />
                  <span>Gemini API: Configured</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#ffc107'
                  }} />
                  <span>Claude API: Check backend logs</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#ffc107'
                  }} />
                  <span>Grok API: Check backend logs</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
