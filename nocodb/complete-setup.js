#!/usr/bin/env node

/**
 * Complete automated NocoDB setup
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const NOCODB_URL = 'http://localhost:8888';
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

    console.log('\n🎉 COMPLETE SETUP SUCCESS!');
    console.log(`📍 Project ID: ${projectId}`);
    console.log(`🔑 API Token: ${finalToken}`);
    console.log('🔗 Web interface: http://localhost:8888');
    console.log('\n📝 Add these to your .env file:');
    console.log(`NOCODB_API_TOKEN=${finalToken}`);
    console.log(`NOCO_CREATE_NEW_PURCHASE_URL=http://nocodb-test:8080/api/v1/db/data/v1/${projectId}/purchases`);

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