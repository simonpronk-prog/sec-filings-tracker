// migrate.js - Run this to add missing database columns
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  console.log('🔄 Running database migration...');
  
  try {
    // Add ai_preferences to users table
    console.log('Adding ai_preferences column to users table...');
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS ai_preferences JSONB 
      DEFAULT '{"claude": false, "gemini": true, "grok": false}'::jsonb
    `);
    console.log('✅ Added ai_preferences column');

    // Add AI analysis columns to filings table
    console.log('Adding AI analysis columns to filings table...');
    
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS ai_summary TEXT`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS ai_detailed_summary TEXT`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS sentiment_direction VARCHAR(20)`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS expected_move_min DECIMAL(5,2)`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS expected_move_max DECIMAL(5,2)`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS expected_move_avg DECIMAL(5,2)`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS confidence_score INTEGER`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS bullish_factors TEXT[]`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS bearish_factors TEXT[]`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS ai_consensus JSONB`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS short_interest_percent DECIMAL(5,2)`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS short_interest_updated_at TIMESTAMP`);
    await pool.query(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS analysis_generated_at TIMESTAMP`);
    
    console.log('✅ Added all AI analysis columns');

    // Verify
    console.log('\n📋 Verifying columns...');
    const usersCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'ai_preferences'
    `);
    console.log('✅ ai_preferences exists:', usersCheck.rows.length > 0);

    const filingsCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'filings' AND column_name = 'ai_summary'
    `);
    console.log('✅ ai_summary exists:', filingsCheck.rows.length > 0);

    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
