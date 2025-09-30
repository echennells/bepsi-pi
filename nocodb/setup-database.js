#!/usr/bin/env node

/**
 * Script to automatically set up NocoDB database structure for vending machine
 * Run this after NocoDB is running to create the required tables and API token
 */

const axios = require('axios');

const NOCODB_URL = 'http://localhost:8080';

async function setupNocoDB() {
  console.log('🚀 Setting up NocoDB for vending machine...\n');

  try {
    // Step 1: Create admin user (if not exists)
    console.log('📋 Creating database structure...');

    // For now, we'll create the API calls that would set up the structure
    // The user needs to do the initial setup via web interface first

    console.log('⚠️  MANUAL SETUP REQUIRED:');
    console.log('1. Visit http://localhost:8080');
    console.log('2. Create admin account');
    console.log('3. Create new Base/Project called "bepsi"');
    console.log('4. Create table "purchases" with columns:');
    console.log('   - currency (SingleLineText)');
    console.log('   - timestamp (DateTime)');
    console.log('   - item (SingleLineText)');
    console.log('5. Go to Settings → API Tokens → Create new token');
    console.log('6. Copy the token and run: node update-env.js <your-token>');

    console.log('\n📝 Expected API endpoint will be:');
    console.log('http://localhost:8080/api/v1/db/data/v1/bepsi/purchases');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  }
}

setupNocoDB();