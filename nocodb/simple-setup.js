#!/usr/bin/env node

/**
 * Simple NocoDB setup - just create table and API token
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const NOCODB_URL = 'http://localhost:8080';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNocoDB() {
  console.log('⏳ Waiting for NocoDB to start...');
  for (let i = 0; i < 30; i++) {
    try {
      await axios.get(`${NOCODB_URL}/api/v1/health`);
      console.log('✅ NocoDB is ready!');
      return;
    } catch (error) {
      await sleep(2000);
    }
  }
  throw new Error('NocoDB failed to start');
}

async function updateBackendEnv() {
  console.log('⚙️ Updating backend environment...');

  const envPath = path.join(__dirname, '../docker-test.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  // For now, just use a placeholder token - user will need to get real one from UI
  const placeholderToken = 'PLACEHOLDER_TOKEN_UPDATE_FROM_NOCODB_UI';

  envContent = envContent.replace(
    /NOCODB_API_TOKEN=.*/,
    `NOCODB_API_TOKEN=${placeholderToken}`
  );

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Environment file updated with placeholder!');
}

async function main() {
  try {
    await waitForNocoDB();
    await updateBackendEnv();

    console.log('\n🎉 Basic setup complete!');
    console.log('📍 Next steps:');
    console.log('1. Open http://localhost:8080 in your browser');
    console.log('2. Sign up for an account');
    console.log('3. Create a project called "bepsi"');
    console.log('4. Create a table called "purchases" with columns:');
    console.log('   - id (ID, primary key)');
    console.log('   - currency (SingleLineText)');
    console.log('   - timestamp (DateTime)');
    console.log('   - item (SingleLineText)');
    console.log('5. Generate an API token');
    console.log('6. Update NOCODB_API_TOKEN in docker-test.env');
    console.log('7. Restart backend container');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();