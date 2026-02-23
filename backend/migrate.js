// migrate.js - Database migration: split filings into shared filings + per-user user_filings
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  console.log('🔄 Running database migration: shared filings + user_filings...');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if migration has already been done (user_filings table exists)
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'user_filings'
      )
    `);

    if (tableCheck.rows[0].exists) {
      console.log('✅ Migration already completed (user_filings table exists). Skipping.');
      await client.query('COMMIT');
      process.exit(0);
    }

    // Check if old filings table has user_id column (confirms it's the old schema)
    const oldSchemaCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'filings' AND column_name = 'user_id'
      )
    `);

    if (!oldSchemaCheck.rows[0].exists) {
      console.log('⚠️ filings table has no user_id column — schema may already be migrated or is fresh. Skipping.');
      await client.query('COMMIT');
      process.exit(0);
    }

    // Count existing data
    const oldCount = await client.query('SELECT COUNT(*) FROM filings');
    console.log(`📊 Old filings table has ${oldCount.rows[0].count} rows`);

    // Step 1: Create new shared filings table
    console.log('📝 Creating filings_shared table...');
    await client.query(`
      CREATE TABLE filings_shared (
        id SERIAL PRIMARY KEY,
        cik VARCHAR(50) NOT NULL,
        company VARCHAR(255),
        form_type VARCHAR(20),
        filed_date DATE,
        description TEXT,
        accession_number VARCHAR(100) UNIQUE NOT NULL,
        primary_document VARCHAR(255),
        report_date DATE,
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
        numbers_confidence VARCHAR(10),
        analysis_generated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ filings_shared table created');

    // Step 2: Create user_filings table
    console.log('📝 Creating user_filings table...');
    await client.query(`
      CREATE TABLE user_filings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        filing_id INTEGER,
        read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ user_filings table created');

    // Step 3: Migrate deduplicated filing data into filings_shared
    // For duplicate accession_numbers, prefer the row with AI analysis
    console.log('📦 Migrating deduplicated filings...');
    const migrateResult = await client.query(`
      INSERT INTO filings_shared (
        cik, company, form_type, filed_date, description,
        accession_number, primary_document, report_date, ai_summary, ai_detailed_summary,
        sentiment_direction, expected_move_min, expected_move_max, expected_move_avg,
        confidence_score, bullish_factors, bearish_factors, ai_consensus,
        short_interest_percent, short_interest_updated_at, numbers_confidence,
        analysis_generated_at, created_at
      )
      SELECT DISTINCT ON (accession_number)
        cik, company, form_type, filed_date, description,
        accession_number, primary_document, report_date, ai_summary, ai_detailed_summary,
        sentiment_direction, expected_move_min, expected_move_max, expected_move_avg,
        confidence_score, bullish_factors, bearish_factors, ai_consensus,
        short_interest_percent, short_interest_updated_at, numbers_confidence,
        analysis_generated_at, created_at
      FROM filings
      ORDER BY accession_number, (ai_summary IS NOT NULL) DESC, analysis_generated_at DESC NULLS LAST
    `);
    console.log(`✅ Migrated ${migrateResult.rowCount} unique filings`);

    // Step 4: Migrate per-user read status into user_filings
    console.log('📦 Migrating user filing links...');
    const linksResult = await client.query(`
      INSERT INTO user_filings (user_id, filing_id, read, created_at)
      SELECT f_old.user_id, f_new.id, f_old.read, f_old.created_at
      FROM filings f_old
      JOIN filings_shared f_new ON f_old.accession_number = f_new.accession_number
    `);
    console.log(`✅ Migrated ${linksResult.rowCount} user-filing links`);

    // Step 5: Swap tables
    console.log('🔄 Swapping tables...');
    await client.query('ALTER TABLE filings RENAME TO filings_old');
    await client.query('ALTER TABLE filings_shared RENAME TO filings');
    console.log('✅ Tables swapped');

    // Step 6: Add foreign key and unique constraint to user_filings now that filings table is renamed
    await client.query('ALTER TABLE user_filings ADD CONSTRAINT user_filings_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES filings(id) ON DELETE CASCADE');
    await client.query('ALTER TABLE user_filings ADD CONSTRAINT user_filings_unique UNIQUE (user_id, filing_id)');

    // Step 7: Create indexes
    console.log('📇 Creating indexes...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_filings_accession ON filings(accession_number)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_filings_cik ON filings(cik)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_filings_date ON filings(filed_date DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_filings_user ON user_filings(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_filings_unread ON user_filings(user_id, read) WHERE read = false');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_filings_filing ON user_filings(filing_id)');
    console.log('✅ Indexes created');

    // Step 8: Verify
    const newFilingsCount = await client.query('SELECT COUNT(*) FROM filings');
    const userFilingsCount = await client.query('SELECT COUNT(*) FROM user_filings');
    console.log(`\n📋 Verification:`);
    console.log(`  Old filings rows: ${oldCount.rows[0].count}`);
    console.log(`  New shared filings: ${newFilingsCount.rows[0].count}`);
    console.log(`  User-filing links: ${userFilingsCount.rows[0].count}`);

    // Step 9: Drop old table
    console.log('🗑️ Dropping old filings table...');
    await client.query('DROP TABLE filings_old');
    console.log('✅ Old table dropped');

    await client.query('COMMIT');
    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed (rolled back):', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

runMigration();
