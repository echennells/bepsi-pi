#!/usr/bin/env node

/**
 * Complete automated NocoDB setup
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const NOCODB_URL = 'http://localhost:8080';
const ADMIN_EMAIL = 'admin@vending.machine';
const ADMIN_PASSWORD = 'VendingMachine123!';

async function getAuthToken() {
  const response = await axios.post(`${NOCODB_URL}/api/v2/auth/user/signin`, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });
  return response.data.token;
}

async function main() {
  try {
    console.log('🔐 Getting fresh auth token...');
    const token = await getAuthToken();

    console.log('📦 Creating project...');
    const project = await axios.post(`${NOCODB_URL}/api/v1/db/meta/projects`, {
      title: 'bepsi'
    }, {
      headers: { 'xc-auth': token }
    });

    const projectId = project.data.id;
    console.log(`✅ Project created: ${projectId}`);

    console.log('📊 Creating purchases table...');
    const table = await axios.post(`${NOCODB_URL}/api/v1/db/meta/projects/${projectId}/tables`, {
      table_name: 'purchases',
      title: 'purchases',
      columns: [
        {
          column_name: 'id',
          title: 'Id',
          uidt: 'ID',
          pk: true,
          ai: true,
          rqd: true,
          un: true
        },
        {
          column_name: 'currency',
          title: 'currency',
          uidt: 'SingleLineText',
          rqd: true
        },
        {
          column_name: 'timestamp',
          title: 'timestamp',
          uidt: 'DateTime',
          rqd: true
        },
        {
          column_name: 'item',
          title: 'item',
          uidt: 'SingleLineText',
          rqd: true
        }
      ]
    }, {
      headers: { 'xc-auth': token }
    });

    console.log('✅ Table created successfully!');

    console.log('🔑 Creating API token...');
    const apiToken = await axios.post(`${NOCODB_URL}/api/v1/db/meta/projects/${projectId}/api-tokens`, {
      description: 'Vending Machine Token'
    }, {
      headers: { 'xc-auth': token }
    });

    const finalToken = apiToken.data.token;

    console.log('⚙️ Updating backend environment...');
    const envPath = path.join(__dirname, '../docker-test.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    envContent = envContent.replace(
      /NOCODB_API_TOKEN=.*/,
      `NOCODB_API_TOKEN=${finalToken}`
    );

    fs.writeFileSync(envPath, envContent);

    console.log('\n🎉 COMPLETE SETUP SUCCESS!');
    console.log(`📍 Project ID: ${projectId}`);
    console.log(`🔑 API Token: ${finalToken.substring(0, 20)}...`);
    console.log('🔗 Web interface: http://localhost:8080');
    console.log('\n🔄 Now restart the backend container:');
    console.log('   docker restart bepsi-pi-development-test');

  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.msg?.includes('already exists')) {
      console.log('✅ Project/table already exists - setup complete!');
    } else {
      console.error('❌ Setup failed:', error.response?.data?.msg || error.message);
      process.exit(1);
    }
  }
}

main();