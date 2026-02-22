// server.js - Backend API for SEC Filings Tracker
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const { authenticator } = require('otplib');

// TOTP helpers using otplib
const TOTP = {
  generateSecret() {
    return authenticator.generateSecret();
  },
  verify(token, secret) {
    return authenticator.check(token, secret);
  },
  getUri(secret, email, issuer = 'SEC Filings Tracker') {
    return authenticator.keyuri(email, issuer, secret);
  }
};


// Import services
const secEdgar = require('./services/secEdgar');
const notifications = require('./services/notifications');
const filingChecker = require('./services/filingChecker');
const aiAnalysis = require('./services/aiAnalysis');
const shortInterest = require('./services/shortInterest');

const app = express();
const PORT = process.env.PORT || 8080;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Middleware
app.use(cors({
  origin: [
    'https://stockmagic.net',
    'https://www.stockmagic.net',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());

// JWT Secret (set this in your environment variables)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
};

// ============================================
// AUTH ROUTES
// ============================================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate TOTP secret for 2FA
    const totpSecret = TOTP.generateSecret();

    const result = await pool.query(
      'INSERT INTO users (email, password, name, notifications_enabled, totp_secret, totp_enabled) VALUES ($1, $2, $3, true, $4, false) RETURNING id, email, name',
      [email, hashedPassword, name, totpSecret]
    );

    const user = result.rows[0];
    const totpUri = TOTP.getUri(totpSecret, email);

    // Return a temporary token for TOTP setup only
    const tempToken = jwt.sign({ id: user.id, email: user.email, setupOnly: true }, JWT_SECRET, {
      expiresIn: '15m'
    });

    res.json({ 
      token: tempToken, 
      user,
      totp: {
        secret: totpSecret,
        uri: totpUri,
        setupRequired: true
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, totpCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // 2FA is mandatory - always require TOTP code
    if (!totpCode) {
      return res.json({ 
        requires2FA: true,
        message: 'Please enter your authenticator code'
      });
    }

    if (!TOTP.verify(totpCode, user.totp_secret)) {
      return res.status(400).json({ error: 'Invalid authenticator code' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: '30d'
    });

    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        totpEnabled: user.totp_enabled
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ============================================
// 2FA / TOTP ROUTES
// ============================================

// Confirm TOTP setup (user scanned QR, now verifying it works)
app.post('/api/auth/totp/confirm', authenticateToken, async (req, res) => {
  try {
    const { totpCode } = req.body;

    const result = await pool.query(
      'SELECT totp_secret, totp_enabled, email FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];
    if (!user || !user.totp_secret) {
      return res.status(400).json({ error: 'No TOTP secret found. Please re-register.' });
    }

    if (user.totp_enabled) {
      return res.json({ message: '2FA is already enabled', totpEnabled: true });
    }

    if (!TOTP.verify(totpCode, user.totp_secret)) {
      return res.status(400).json({ error: 'Invalid code. Please try again.' });
    }

    // Enable 2FA
    await pool.query(
      'UPDATE users SET totp_enabled = true WHERE id = $1',
      [req.user.id]
    );

    // Issue a full access token now that 2FA is confirmed
    const token = jwt.sign({ id: req.user.id, email: user.email }, JWT_SECRET, {
      expiresIn: '30d'
    });

    res.json({ message: '2FA enabled successfully', totpEnabled: true, token });
  } catch (error) {
    console.error('TOTP confirm error:', error);
    res.status(500).json({ error: 'Error confirming 2FA setup' });
  }
});

// Get TOTP setup info (for users who haven't set up yet)
app.get('/api/auth/totp/setup', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT email, totp_secret, totp_enabled FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.totp_enabled) {
      return res.json({ totpEnabled: true });
    }

    // Generate new secret if none exists
    let secret = user.totp_secret;
    if (!secret) {
      secret = TOTP.generateSecret();
      await pool.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, req.user.id]);
    }

    res.json({
      totpEnabled: false,
      secret,
      uri: TOTP.getUri(secret, user.email)
    });
  } catch (error) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ error: 'Error getting 2FA setup' });
  }
});

// Password reset via TOTP
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, totpCode, newPassword } = req.body;

    if (!email || !totpCode || !newPassword) {
      return res.status(400).json({ error: 'Email, authenticator code, and new password required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      // Don't reveal if user exists
      return res.status(400).json({ error: 'Invalid email or authenticator code' });
    }

    const user = result.rows[0];

    if (!user.totp_secret) {
      return res.status(400).json({ error: 'Account setup incomplete. Please contact support.' });
    }

    if (!TOTP.verify(totpCode, user.totp_secret)) {
      return res.status(400).json({ error: 'Invalid authenticator code' });
    }

    // Reset password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Error resetting password' });
  }
});

// ============================================
// WATCHLIST ROUTES (Protected)
// ============================================

// Get user's watchlist
app.get('/api/watchlist', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM watchlist WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get watchlist error:', error);
    res.status(500).json({ error: 'Error fetching watchlist' });
  }
});

// Add entity to watchlist
app.post('/api/watchlist', authenticateToken, async (req, res) => {
  try {
    const { cik, name, ticker } = req.body;

    // Check if already exists
    const existing = await pool.query(
      'SELECT * FROM watchlist WHERE user_id = $1 AND cik = $2',
      [req.user.id, cik]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Entity already in watchlist' });
    }

    const result = await pool.query(
      'INSERT INTO watchlist (user_id, cik, name, ticker) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, cik, name, ticker]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Add to watchlist error:', error);
    res.status(500).json({ error: 'Error adding to watchlist' });
  }
});

// Remove from watchlist
app.delete('/api/watchlist/:cik', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM watchlist WHERE user_id = $1 AND cik = $2',
      [req.user.id, req.params.cik]
    );
    res.json({ message: 'Removed from watchlist' });
  } catch (error) {
    console.error('Remove from watchlist error:', error);
    res.status(500).json({ error: 'Error removing from watchlist' });
  }
});

// ============================================
// SEC FILINGS ROUTES (Protected)
// ============================================

// Search SEC companies
app.get('/api/sec/search', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    
    console.log('🔍 Search request received:', { query, userId: req.user.id });
    
    if (!query || query.length < 2) {
      return res.json([]);
    }

    console.log('📡 Calling secEdgar.searchCompanies...');
    const results = await secEdgar.searchCompanies(query);
    console.log('✅ Search results:', results.length, 'companies found');
    
    res.json(results);
  } catch (error) {
    console.error('❌ SEC search error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error searching SEC data', details: error.message });
  }
});

// Get filings for watchlist
app.get('/api/sec/filings', authenticateToken, async (req, res) => {
  try {
    const daysBack = parseInt(req.query.daysBack) || 7;
    console.log('📋 Fetching filings for user:', req.user.id, 'looking back', daysBack, 'days');
    
    // Get user's AI preferences
    const userPrefs = await pool.query(
      'SELECT ai_preferences FROM users WHERE id = $1',
      [req.user.id]
    );
    const aiPreferences = userPrefs.rows[0]?.ai_preferences || { claude: true, gemini: true, grok: true };
    console.log('🎯 User AI preferences:', aiPreferences);
    
    const watchlist = await pool.query(
      'SELECT cik, name, ticker FROM watchlist WHERE user_id = $1',
      [req.user.id]
    );

    const ciks = watchlist.rows.map(w => w.cik);
    console.log('👀 Watchlist CIKs:', ciks);

    if (ciks.length === 0) {
      console.log('⚠️ No companies in watchlist');
      return res.json([]);
    }

    // Fetch real filings from SEC EDGAR
    console.log('🔍 Calling SEC API for filings...');
    const filings = await secEdgar.getFilingsForWatchlist(ciks, daysBack);
    console.log('✅ Found', filings.length, 'filings');

    // Process each filing
    const enrichedFilings = [];
    
    for (const filing of filings) {
      try {
        // Check if filing already exists with analysis
        const existing = await pool.query(
          `SELECT * FROM filings WHERE user_id = $1 AND accession_number = $2`,
          [req.user.id, filing.accessionNumber]
        );

        let filingData = filing;
        
        if (existing.rows.length > 0) {
          // Use existing analysis if available
          const existingFiling = existing.rows[0];
          if (existingFiling.ai_summary) {
            filingData = {
              ...filing,
              ai_summary: existingFiling.ai_summary,
              ai_detailed_summary: existingFiling.ai_detailed_summary,
              sentiment_direction: existingFiling.sentiment_direction,
              expected_move_min: existingFiling.expected_move_min,
              expected_move_max: existingFiling.expected_move_max,
              expected_move_avg: existingFiling.expected_move_avg,
              confidence_score: existingFiling.confidence_score,
              bullish_factors: existingFiling.bullish_factors,
              bearish_factors: existingFiling.bearish_factors,
              ai_consensus: existingFiling.ai_consensus,
              short_interest_percent: existingFiling.short_interest_percent,
              priority: aiAnalysis.getFilingPriority(filing.formType)
            };
            filingData.ticker = ticker; enrichedFilings.push(filingData);
            continue;
          }
        }

        // Get ticker for this company
        const companyInfo = watchlist.rows.find(w => w.cik === filing.cik);
        const ticker = companyInfo?.ticker;

        // Add priority info
        const priority = aiAnalysis.getFilingPriority(filing.formType);
        filingData.priority = priority;

        // Only analyze high-priority filings
        if (priority.level === 'high' && ticker) {
          console.log(`🤖 Analyzing ${filing.formType} for ${filing.company}...`);
          
          // Fetch filing text using VERSION 2.0 parser
          try {
            const filingText = await secEdgar.parseFilingContent(
              filing.accessionNumber,
              filing.cik,
              filing.primaryDocument
            );

            // Get AI analysis (runs selected AIs based on user preferences)
            const analysis = await aiAnalysis.analyzeFiling(
              filingText,
              filing.company,
              filing.formType,
              ticker,
              aiPreferences
            );

            if (analysis) {
              // Get short interest data
              const shortData = await shortInterest.getShortInterest(ticker);

              // Add analysis to filing data
              filingData = {
                ...filing,
                ...analysis,
                ai_summary: analysis.brief_summary,
                short_interest_percent: shortData?.short_volume_percent || null,
                short_interest_updated_at: shortData?.updated_at || null,
                priority
              };

              // Save to database
              await pool.query(
                `INSERT INTO filings (
                  user_id, cik, form_type, filed_date, description, accession_number, 
                  company, primary_document, report_date, ai_summary, ai_detailed_summary,
                  sentiment_direction, expected_move_min, expected_move_max, expected_move_avg,
                  confidence_score, bullish_factors, bearish_factors, ai_consensus,
                  short_interest_percent, short_interest_updated_at, analysis_generated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
                ON CONFLICT (user_id, accession_number) 
                DO UPDATE SET
                  ai_summary = EXCLUDED.ai_summary,
                  ai_detailed_summary = EXCLUDED.ai_detailed_summary,
                  sentiment_direction = EXCLUDED.sentiment_direction,
                  expected_move_min = EXCLUDED.expected_move_min,
                  expected_move_max = EXCLUDED.expected_move_max,
                  expected_move_avg = EXCLUDED.expected_move_avg,
                  confidence_score = EXCLUDED.confidence_score,
                  bullish_factors = EXCLUDED.bullish_factors,
                  bearish_factors = EXCLUDED.bearish_factors,
                  ai_consensus = EXCLUDED.ai_consensus,
                  short_interest_percent = EXCLUDED.short_interest_percent,
                  short_interest_updated_at = EXCLUDED.short_interest_updated_at,
                  analysis_generated_at = EXCLUDED.analysis_generated_at`,
                [
                  req.user.id, filing.cik, filing.formType, filing.filedDate,
                  filing.description, filing.accessionNumber, filing.company,
                  filing.primaryDocument, filing.reportDate,
                  analysis.brief_summary, analysis.detailed_summary,
                  analysis.sentiment_direction, analysis.expected_move_min,
                  analysis.expected_move_max, analysis.expected_move_avg,
                  analysis.confidence_score, analysis.bullish_factors,
                  analysis.bearish_factors, JSON.stringify(analysis.ai_consensus),
                  shortData?.short_volume_percent || null,
                  shortData?.updated_at || null
                ]
              );
            }
          } catch (analysisError) {
            console.error('⚠️ Analysis error for filing:', filing.accessionNumber, analysisError.message);
            // Continue with unanalyzed filing
          }
        } else {
          // Low priority filing - just save without analysis
          await pool.query(
            `INSERT INTO filings (user_id, cik, form_type, filed_date, description, accession_number, company, primary_document, report_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, accession_number) DO NOTHING`,
            [req.user.id, filing.cik, filing.formType, filing.filedDate,
             filing.description, filing.accessionNumber, filing.company,
             filing.primaryDocument, filing.reportDate]
          );
        }

        filingData.ticker = ticker; enrichedFilings.push(filingData);
      } catch (filingError) {
        console.error('⚠️ Error processing filing:', filing.accessionNumber, filingError.message);
        // Add filing without analysis
        enrichedFilings.push({
          ...filing,
          priority: aiAnalysis.getFilingPriority(filing.formType)
        });
      }
    }

    res.json(enrichedFilings);
  } catch (error) {
    console.error('❌ Get filings error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error fetching filings', details: error.message });
  }
});

// Mark filing as read
app.post('/api/filings/:accessionNumber/read', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE filings SET read = true WHERE user_id = $1 AND accession_number = $2',
      [req.user.id, req.params.accessionNumber]
    );
    res.json({ message: 'Filing marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Error marking filing as read' });
  }
});

// Regenerate AI analysis for a filing
app.post('/api/filings/:accessionNumber/analyze', authenticateToken, async (req, res) => {
  try {
    const { accessionNumber } = req.params;
    
    // Get filing from database
    const result = await pool.query(
      `SELECT f.*, w.ticker FROM filings f
       JOIN watchlist w ON f.cik = w.cik AND f.user_id = w.user_id
       WHERE f.user_id = $1 AND f.accession_number = $2`,
      [req.user.id, accessionNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Filing not found' });
    }

    const filing = result.rows[0];
    
    console.log(`🔄 Regenerating analysis for ${filing.form_type} - ${filing.company}...`);

    // Get user's AI preferences
    const userPrefs = await pool.query(
      'SELECT ai_preferences FROM users WHERE id = $1',
      [req.user.id]
    );
    const aiPreferences = userPrefs.rows[0]?.ai_preferences || { claude: true, gemini: true, grok: true };

    // Fetch filing text using VERSION 2.0 parser
    const filingText = await secEdgar.parseFilingContent(
      filing.accession_number,
      filing.cik,
      filing.primary_document
    );

    // Get fresh AI analysis with user preferences
    const analysis = await aiAnalysis.analyzeFiling(
      filingText,
      filing.company,
      filing.form_type,
      filing.ticker,
      aiPreferences
    );

    if (!analysis) {
      return res.status(500).json({ error: 'Failed to generate analysis' });
    }

    // Get fresh short interest data
    const shortData = await shortInterest.getShortInterest(filing.ticker);

    // Update database
    await pool.query(
      `UPDATE filings SET
        ai_summary = $1,
        ai_detailed_summary = $2,
        sentiment_direction = $3,
        expected_move_min = $4,
        expected_move_max = $5,
        expected_move_avg = $6,
        confidence_score = $7,
        bullish_factors = $8,
        bearish_factors = $9,
        ai_consensus = $10,
        short_interest_percent = $11,
        short_interest_updated_at = $12,
        analysis_generated_at = NOW()
       WHERE user_id = $13 AND accession_number = $14`,
      [
        analysis.brief_summary,
        analysis.detailed_summary,
        analysis.sentiment_direction,
        analysis.expected_move_min,
        analysis.expected_move_max,
        analysis.expected_move_avg,
        analysis.confidence_score,
        analysis.bullish_factors,
        analysis.bearish_factors,
        JSON.stringify(analysis.ai_consensus),
        shortData?.short_volume_percent || null,
        shortData?.updated_at || null,
        req.user.id,
        accessionNumber
      ]
    );

    res.json({
      ...analysis,
      short_interest_percent: shortData?.short_volume_percent || null,
      priority: aiAnalysis.getFilingPriority(filing.form_type)
    });
  } catch (error) {
    console.error('Regenerate analysis error:', error);
    res.status(500).json({ error: 'Error regenerating analysis' });
  }
});

// ============================================
// NOTIFICATION PREFERENCES ROUTES
// ============================================

// Get user notification preferences
app.get('/api/preferences', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT notification_preferences, notifications_enabled, phone, ai_preferences FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Error fetching preferences' });
  }
});

// Update notification preferences
app.put('/api/preferences', authenticateToken, async (req, res) => {
  try {
    const { notificationPreferences, notificationsEnabled, phone, aiPreferences } = req.body;

    await pool.query(
      `UPDATE users 
       SET notification_preferences = $1, notifications_enabled = $2, phone = $3, ai_preferences = $4
       WHERE id = $5`,
      [JSON.stringify(notificationPreferences), notificationsEnabled, phone, JSON.stringify(aiPreferences), req.user.id]
    );

    res.json({ message: 'Preferences updated' });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Error updating preferences' });
  }
});

// Trigger manual filing check
app.post('/api/check-filings', authenticateToken, async (req, res) => {
  try {
    await filingChecker.manualCheck(req.user.id);
    res.json({ message: 'Filing check completed' });
  } catch (error) {
    console.error('Manual check error:', error);
    res.status(500).json({ error: 'Error checking for filings' });
  }
});

// Get filing checker status (admin only)
app.get('/api/admin/status', authenticateToken, async (req, res) => {
  try {
    const status = await filingChecker.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Error fetching status' });
  }
});

// ============================================
// DASHBOARD ROUTE
// ============================================
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get watchlist with filing stats per ticker
    const tickerStats = await pool.query(`
      SELECT 
        w.ticker,
        w.name,
        w.cik,
        COUNT(f.id) AS total_filings,
        COUNT(CASE WHEN f.read = false THEN 1 END) AS unread_count,
        COUNT(CASE WHEN f.ai_summary IS NOT NULL THEN 1 END) AS analyzed_count,
        MAX(f.filed_date) AS latest_filing_date,
        -- Get the most recent analyzed filing's sentiment
        (SELECT f2.sentiment_direction FROM filings f2 
         WHERE f2.cik = w.cik AND f2.user_id = $1 AND f2.ai_summary IS NOT NULL
         ORDER BY f2.filed_date DESC LIMIT 1) AS latest_sentiment,
        (SELECT f2.expected_move_avg FROM filings f2 
         WHERE f2.cik = w.cik AND f2.user_id = $1 AND f2.ai_summary IS NOT NULL
         ORDER BY f2.filed_date DESC LIMIT 1) AS latest_move_avg,
        (SELECT f2.confidence_score FROM filings f2 
         WHERE f2.cik = w.cik AND f2.user_id = $1 AND f2.ai_summary IS NOT NULL
         ORDER BY f2.filed_date DESC LIMIT 1) AS latest_confidence,
        (SELECT f2.form_type FROM filings f2 
         WHERE f2.cik = w.cik AND f2.user_id = $1
         ORDER BY f2.filed_date DESC LIMIT 1) AS latest_form_type,
        (SELECT f2.ai_summary FROM filings f2 
         WHERE f2.cik = w.cik AND f2.user_id = $1 AND f2.ai_summary IS NOT NULL
         ORDER BY f2.filed_date DESC LIMIT 1) AS latest_summary
      FROM watchlist w
      LEFT JOIN filings f ON f.cik = w.cik AND f.user_id = w.user_id
      WHERE w.user_id = $1
      GROUP BY w.ticker, w.name, w.cik
      ORDER BY MAX(f.filed_date) DESC NULLS LAST
    `, [userId]);

    // Get recent high-priority filings (needle movers)
    const needleMovers = await pool.query(`
      SELECT 
        f.accession_number,
        f.company,
        f.form_type,
        f.filed_date,
        f.ai_summary,
        f.sentiment_direction,
        f.expected_move_avg,
        f.confidence_score,
        f.read,
        w.ticker
      FROM filings f
      JOIN watchlist w ON f.cik = w.cik AND f.user_id = w.user_id
      WHERE f.user_id = $1
        AND f.ai_summary IS NOT NULL
        AND f.form_type IN ('10-K', '10-Q', '8-K', '6-K', '20-F', '13F-HR', 'SC 13D', 'SC 13G', 'DEF 14A', '4', 'S-1')
      ORDER BY f.filed_date DESC
      LIMIT 20
    `, [userId]);

    // Summary stats
    const totalUnread = tickerStats.rows.reduce((sum, r) => sum + parseInt(r.unread_count || 0), 0);
    const bullishCount = tickerStats.rows.filter(r => r.latest_sentiment === 'bullish').length;
    const bearishCount = tickerStats.rows.filter(r => r.latest_sentiment === 'bearish').length;
    const neutralCount = tickerStats.rows.filter(r => r.latest_sentiment && r.latest_sentiment !== 'bullish' && r.latest_sentiment !== 'bearish').length;

    res.json({
      tickers: tickerStats.rows,
      needleMovers: needleMovers.rows,
      summary: {
        totalUnread,
        totalTickers: tickerStats.rows.length,
        bullish: bullishCount,
        bearish: bearishCount,
        neutral: neutralCount
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Error fetching dashboard data' });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize cron jobs for automated filing checks
  filingChecker.initializeCronJobs();
});

// Initialize database tables
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        phone VARCHAR(20),
        notifications_enabled BOOLEAN DEFAULT true,
        notification_preferences JSONB DEFAULT '{"instantEmail": true, "instantSms": false, "dailyDigest": false, "weeklyDigest": false}'::jsonb,
        ai_preferences JSONB DEFAULT '{"claude": true, "gemini": true, "grok": true}'::jsonb,
        totp_secret VARCHAR(64),
        totp_enabled BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Add TOTP columns if they don't exist (for existing installs)
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        cik VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        ticker VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, cik)
      );

      CREATE TABLE IF NOT EXISTS filings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        cik VARCHAR(50) NOT NULL,
        company VARCHAR(255),
        form_type VARCHAR(20),
        filed_date DATE,
        description TEXT,
        accession_number VARCHAR(100),
        primary_document VARCHAR(255),
        report_date DATE,
        read BOOLEAN DEFAULT false,
        ai_summary TEXT,
        ai_detailed_summary TEXT,
        sentiment_direction VARCHAR(20),
        expected_move_min DECIMAL(5,2),
        expected_move_max DECIMAL(5,2),
        expected_move_avg DECIMAL(5,2),
        confidence_score INTEGER,
        bullish_factors TEXT[],
        bearish_factors TEXT[],
        ai_consensus JSONB,
        short_interest_percent DECIMAL(5,2),
        short_interest_updated_at TIMESTAMP,
        analysis_generated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, accession_number)
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_check_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notification_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        filing_count INTEGER,
        notification_type VARCHAR(20),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
      CREATE INDEX IF NOT EXISTS idx_filings_user ON filings(user_id);
      CREATE INDEX IF NOT EXISTS idx_filings_date ON filings(filed_date DESC);
      CREATE INDEX IF NOT EXISTS idx_filings_unread ON filings(user_id, read) WHERE read = false;
    `);
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

initDatabase();
