#!/usr/bin/env node

/**
 * Database Initialization Script
 * Applies schema to PostgreSQL database
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function initDatabase() {
  console.log('🗄️ AgentHunt Database Initialization');
  console.log('====================================\n');

  try {
    // Test connection
    console.log('🔄 Testing database connection...');
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Apply main schema
    console.log('📝 Applying main database schema...');
    const mainSchema = fs.readFileSync(
      path.join(__dirname, '../backend/src/models/database.sql'),
      'utf8'
    );

    try {
      await pool.query(mainSchema);
      console.log('✅ Main schema applied successfully');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⚠️  Some tables already exist (this is okay)');
      } else {
        throw error;
      }
    }

    // Apply submissions schema if it exists
    const submissionsSchemaPath = path.join(__dirname, '../backend/src/models/submissions.sql');
    if (fs.existsSync(submissionsSchemaPath)) {
      console.log('\n📝 Applying submissions schema...');
      const submissionsSchema = fs.readFileSync(submissionsSchemaPath, 'utf8');

      try {
        await pool.query(submissionsSchema);
        console.log('✅ Submissions schema applied successfully');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⚠️  Some tables already exist (this is okay)');
        } else {
          throw error;
        }
      }
    }

    // Verify manager_commands table exists
    console.log('\n🔍 Verifying manager_commands table...');
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'manager_commands'
      ORDER BY ordinal_position
    `);

    if (result.rows.length > 0) {
      console.log('✅ manager_commands table verified:');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type}`);
      });
    } else {
      console.log('❌ manager_commands table not found');
    }

    // List all tables
    console.log('\n📋 All tables in database:');
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    tables.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.table_name}`);
    });

    console.log('\n✅ Database initialization complete!');

  } catch (error) {
    console.error('\n❌ Database initialization failed:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
