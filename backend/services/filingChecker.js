// services/filingChecker.js - Automated Filing Checker with Cron Jobs
const cron = require('node-cron');
const { Pool } = require('pg');
const secEdgar = require('./secEdgar');
const notifications = require('./notifications');

class FilingCheckerService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    this.isRunning = false;
    this.lastCheckTime = null;
  }

  // Initialize cron jobs
  initializeCronJobs() {
    // Check for new filings every 15 minutes during market hours (9 AM - 6 PM ET, Mon-Fri)
    cron.schedule('*/15 9-18 * * 1-5', async () => {
      console.log('Running scheduled filing check...');
      await this.checkAllWatchlistsForNewFilings();
    }, {
      timezone: 'America/New_York'
    });

    // Send daily digest at 6 PM ET
    cron.schedule('0 18 * * 1-5', async () => {
      console.log('Sending daily digest emails...');
      await this.sendDailyDigests();
    }, {
      timezone: 'America/New_York'
    });

    // Send weekly digest on Friday at 5 PM ET
    cron.schedule('0 17 * * 5', async () => {
      console.log('Sending weekly digest emails...');
      await this.sendWeeklyDigests();
    }, {
      timezone: 'America/New_York'
    });

    // Cleanup old filings data every Sunday at 2 AM
    cron.schedule('0 2 * * 0', async () => {
      console.log('Cleaning up old filing data...');
      await this.cleanupOldFilings();
    });

    console.log('✅ Cron jobs initialized');
    console.log('📅 Schedule:');
    console.log('  - Filing checks: Every 15 min (9 AM - 6 PM ET, Mon-Fri)');
    console.log('  - Daily digest: 6 PM ET (Mon-Fri)');
    console.log('  - Weekly digest: 5 PM ET (Fridays)');
    console.log('  - Cleanup: 2 AM ET (Sundays)');
  }

  // Check all users' watchlists for new filings
  async checkAllWatchlistsForNewFilings() {
    if (this.isRunning) {
      console.log('Filing check already in progress, skipping...');
      return;
    }

    this.isRunning = true;

    try {
      // Get all active users with watchlists
      const usersResult = await this.pool.query(`
        SELECT DISTINCT u.id, u.email, u.name, u.notification_preferences
        FROM users u
        INNER JOIN watchlist w ON u.id = w.user_id
        WHERE u.notifications_enabled = true
      `);

      console.log(`Checking filings for ${usersResult.rows.length} users...`);

      for (const user of usersResult.rows) {
        try {
          await this.checkUserWatchlist(user);
        } catch (error) {
          console.error(`Error checking watchlist for user ${user.id}:`, error);
          // Continue with other users even if one fails
        }
      }

      this.lastCheckTime = new Date();
      console.log(`✅ Filing check completed at ${this.lastCheckTime}`);
    } catch (error) {
      console.error('Error in checkAllWatchlistsForNewFilings:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Check a specific user's watchlist
  async checkUserWatchlist(user) {
    // Get user's watchlist
    const watchlistResult = await this.pool.query(
      'SELECT cik, name FROM watchlist WHERE user_id = $1',
      [user.id]
    );

    if (watchlistResult.rows.length === 0) {
      return;
    }

    const ciks = watchlistResult.rows.map(w => w.cik);
    
    // Get the last time we checked for this user
    const lastCheckResult = await this.pool.query(
      'SELECT last_check_time FROM user_preferences WHERE user_id = $1',
      [user.id]
    );

    const lastCheck = lastCheckResult.rows[0]?.last_check_time || new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Fetch new filings from SEC
    const allNewFilings = [];
    
    for (const cik of ciks) {
      try {
        const newFilings = await secEdgar.checkForNewFilings(cik, lastCheck);
        allNewFilings.push(...newFilings);
      } catch (error) {
        console.error(`Error fetching filings for CIK ${cik}:`, error);
      }
    }

    if (allNewFilings.length === 0) {
      console.log(`No new filings for user ${user.email}`);
      return;
    }

    console.log(`Found ${allNewFilings.length} new filings for user ${user.email}`);

    // Store new filings in database
    for (const filing of allNewFilings) {
      await this.storeFilingInDatabase(user.id, filing);
    }

    // Send notifications based on user preferences
    await this.sendNotifications(user, allNewFilings);

    // Update last check time
    await this.pool.query(
      `INSERT INTO user_preferences (user_id, last_check_time)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET last_check_time = $2`,
      [user.id, new Date()]
    );
  }

  // Store filing in database
  async storeFilingInDatabase(userId, filing) {
    try {
      await this.pool.query(
        `INSERT INTO filings (user_id, cik, company, form_type, filed_date, description, accession_number, primary_document, report_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, accession_number) DO NOTHING`,
        [
          userId,
          filing.cik,
          filing.company,
          filing.formType,
          filing.filedDate,
          filing.description,
          filing.accessionNumber,
          filing.primaryDocument,
          filing.reportDate
        ]
      );
    } catch (error) {
      console.error('Error storing filing:', error);
    }
  }

  // Send notifications to user
  async sendNotifications(user, filings) {
    const prefs = user.notification_preferences || {};
    
    // Default to instant email notifications
    const instantEmail = prefs.instantEmail !== false;
    const instantSms = prefs.instantSms === true;
    
    // Filter filings based on user's form type preferences
    let filingsToNotify = filings;
    if (prefs.formTypes && prefs.formTypes.length > 0) {
      filingsToNotify = filings.filter(f => prefs.formTypes.includes(f.formType));
    }

    if (filingsToNotify.length === 0) {
      return;
    }

    // Send instant email notification
    if (instantEmail) {
      try {
        await notifications.sendFilingAlertEmail(user, filingsToNotify);
        console.log(`✉️ Email sent to ${user.email}`);
      } catch (error) {
        console.error(`Failed to send email to ${user.email}:`, error);
      }
    }

    // Send SMS notification
    if (instantSms && user.phone) {
      try {
        await notifications.sendFilingAlertSMS(user.phone, filingsToNotify);
        console.log(`📱 SMS sent to ${user.phone}`);
      } catch (error) {
        console.error(`Failed to send SMS to ${user.phone}:`, error);
      }
    }

    // Log notification
    await this.pool.query(
      `INSERT INTO notification_log (user_id, filing_count, notification_type, sent_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, filingsToNotify.length, instantEmail ? 'email' : 'sms', new Date()]
    );
  }

  // Send daily digest emails
  async sendDailyDigests() {
    try {
      const usersResult = await this.pool.query(`
        SELECT DISTINCT u.id, u.email, u.name
        FROM users u
        WHERE u.notification_preferences->>'dailyDigest' = 'true'
      `);

      for (const user of usersResult.rows) {
        try {
          // Get today's filings for this user
          const filingsResult = await this.pool.query(
            `SELECT * FROM filings 
             WHERE user_id = $1 
             AND filed_date >= CURRENT_DATE
             ORDER BY filed_date DESC`,
            [user.id]
          );

          if (filingsResult.rows.length > 0) {
            await notifications.sendDigestEmail(user, filingsResult.rows, 'daily');
            console.log(`📊 Daily digest sent to ${user.email}`);
          }
        } catch (error) {
          console.error(`Failed to send daily digest to ${user.email}:`, error);
        }
      }
    } catch (error) {
      console.error('Error sending daily digests:', error);
    }
  }

  // Send weekly digest emails
  async sendWeeklyDigests() {
    try {
      const usersResult = await this.pool.query(`
        SELECT DISTINCT u.id, u.email, u.name
        FROM users u
        WHERE u.notification_preferences->>'weeklyDigest' = 'true'
      `);

      for (const user of usersResult.rows) {
        try {
          // Get this week's filings for this user
          const filingsResult = await this.pool.query(
            `SELECT * FROM filings 
             WHERE user_id = $1 
             AND filed_date >= CURRENT_DATE - INTERVAL '7 days'
             ORDER BY filed_date DESC`,
            [user.id]
          );

          if (filingsResult.rows.length > 0) {
            await notifications.sendDigestEmail(user, filingsResult.rows, 'weekly');
            console.log(`📊 Weekly digest sent to ${user.email}`);
          }
        } catch (error) {
          console.error(`Failed to send weekly digest to ${user.email}:`, error);
        }
      }
    } catch (error) {
      console.error('Error sending weekly digests:', error);
    }
  }

  // Cleanup old filings (keep last 90 days)
  async cleanupOldFilings() {
    try {
      const result = await this.pool.query(
        `DELETE FROM filings 
         WHERE filed_date < CURRENT_DATE - INTERVAL '90 days'`
      );

      console.log(`🗑️ Cleaned up ${result.rowCount} old filings`);
    } catch (error) {
      console.error('Error cleaning up old filings:', error);
    }
  }

  // Manual trigger for testing
  async manualCheck(userId) {
    console.log(`Manual filing check triggered for user ${userId}`);
    
    const userResult = await this.pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    await this.checkUserWatchlist(userResult.rows[0]);
    return { success: true, message: 'Manual check completed' };
  }

  // Get status and statistics
  async getStatus() {
    const stats = await this.pool.query(`
      SELECT 
        COUNT(DISTINCT user_id) as total_users,
        COUNT(*) as total_watchlist_items,
        (SELECT COUNT(*) FROM filings WHERE filed_date >= CURRENT_DATE) as filings_today,
        (SELECT COUNT(*) FROM filings WHERE filed_date >= CURRENT_DATE - INTERVAL '7 days') as filings_this_week
      FROM watchlist
    `);

    return {
      isRunning: this.isRunning,
      lastCheckTime: this.lastCheckTime,
      stats: stats.rows[0]
    };
  }
}

module.exports = new FilingCheckerService();
