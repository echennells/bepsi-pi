#!/usr/bin/env node

/**
 * Script to update the backend environment to use local NocoDB
 * Usage: node update-env.js <api-token>
 */

const fs = require('fs');
const path = require('path');

const apiToken = process.argv[2];

if (!apiToken) {
  console.error('❌ Please provide API token: node update-env.js <token>');
  process.exit(1);
}

const envPath = path.join(__dirname, '../docker-test.env');

try {
  // Read current env file
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Update NocoDB settings
  const nocodeUpdates = {
    'NOCODB_API_TOKEN': apiToken,
    'NOCO_CREATE_NEW_PURCHASE_URL': 'http://host.docker.internal:8080/api/v1/db/data/v1/bepsi/purchases'
  };

  // Add or update each setting
  for (const [key, value] of Object.entries(nocodeUpdates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}=${value}`;

    if (regex.test(envContent)) {
      // Update existing line
      envContent = envContent.replace(regex, newLine);
    } else {
      // Add new line
      envContent += `\n${newLine}`;
    }
  }

  // Write updated env file
  fs.writeFileSync(envPath, envContent);

  console.log('✅ Updated docker-test.env with local NocoDB settings:');
  console.log(`   NOCODB_API_TOKEN=${apiToken.substring(0, 20)}...`);
  console.log('   NOCO_CREATE_NEW_PURCHASE_URL=http://host.docker.internal:8080/api/v1/db/data/v1/bepsi/purchases');
  console.log('\n🔄 Restart the backend container to apply changes:');
  console.log('   docker restart bepsi-pi-development-test');

} catch (error) {
  console.error('❌ Failed to update env file:', error.message);
  process.exit(1);
}