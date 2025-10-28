#!/usr/bin/env node

/**
 * Automated NocoDB setup for vending machine
 * This script will create the project, table, and API token programmatically
 */

const axios = require('axios');

const NOCODB_URL = 'http://localhost:8080';

// Try different API versions
const API_PATHS = [
  '/api/v1',
  '/api/v2',
  '/api/v1/db/meta'
];
const ADMIN_EMAIL = 'admin@vending.machine';
const ADMIN_PASSWORD = 'VendingMachine123!';

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

async function createAdminUser() {
  console.log('👤 Creating admin user...');

  try {
    const response = await axios.post(`${NOCODB_URL}/api/v1/auth/user/signup`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      firstname: 'Admin',
      lastname: 'User'
    });

    console.log('✅ Admin user created!');
    return response.data.token;
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('👤 Admin user may already exist, trying to sign in...');
      return null; // Will try sign in instead
    }
    throw new Error(`Failed to create admin user: ${error.response?.data?.msg || error.message}`);
  }
}

async function signIn() {
  console.log('🔐 Signing in as admin...');

  try {
    const response = await axios.post(`${NOCODB_URL}/api/v1/auth/user/signin`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });

    return response.data.token;
  } catch (error) {
    throw new Error(`Failed to sign in: ${error.response?.data?.msg || error.message}`);
  }
}

async function createProject(token) {
  console.log('📦 Creating "bepsi" project...');

  try {
    const response = await axios.post(`${NOCODB_URL}/api/v1/db/meta/projects`, {
      title: 'bepsi',
      bases: [{
        type: 'sqlite3',
        config: {
          client: 'sqlite3',
          connection: {
            filename: '/usr/app/data/bepsi.db'
          }
        }
      }]
    }, {
      headers: { 'xc-token': token }
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.msg?.includes('already exists')) {
      console.log('📦 Project "bepsi" already exists, continuing...');
      // Get existing project
      const projects = await axios.get(`${NOCODB_URL}/api/v1/db/meta/projects`, {
        headers: { 'xc-token': token }
      });
      return projects.data.list.find(p => p.title === 'bepsi');
    }
    throw new Error(`Failed to create project: ${error.response?.data?.msg || error.message}`);
  }
}

async function createTable(token, projectId, baseId) {
  console.log('📊 Creating "purchases" table...');

  try {
    const response = await axios.post(`${NOCODB_URL}/api/v1/db/meta/projects/${projectId}/tables`, {
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
      headers: { 'xc-token': token }
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.msg?.includes('already exists')) {
      console.log('📊 Table "purchases" already exists, continuing...');
      return null;
    }
    throw new Error(`Failed to create table: ${error.response?.data?.msg || error.message}`);
  }
}

async function createApiToken(token, projectId) {
  console.log('🔑 Creating API token...');

  try {
    const response = await axios.post(`${NOCODB_URL}/api/v1/db/meta/projects/${projectId}/api-tokens`, {
      description: 'Vending Machine Token'
    }, {
      headers: { 'xc-token': token }
    });

    return response.data.token;
  } catch (error) {
    throw new Error(`Failed to create API token: ${error.response?.data?.msg || error.message}`);
  }
}

async function updateBackendEnv(apiToken) {
  const fs = require('fs');
  const path = require('path');

  console.log('⚙️ Updating backend environment...');

  const envPath = path.join(__dirname, '../docker-test.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Update the token
  envContent = envContent.replace(
    /NOCODB_API_TOKEN=.*/,
    `NOCODB_API_TOKEN=${apiToken}`
  );

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Environment updated!');
}

async function main() {
  try {
    await waitForNocoDB();

    // Try to create admin user first, then sign in
    let authToken = await createAdminUser();
    if (!authToken) {
      authToken = await signIn();
    }

    const project = await createProject(authToken);
    const projectId = project.id;
    const baseId = project.bases[0].id;

    await createTable(authToken, projectId, baseId);

    const apiToken = await createApiToken(authToken, projectId);

    await updateBackendEnv(apiToken);

    console.log('\n🎉 Setup complete!');
    console.log(`📍 Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`🔗 Web interface: ${NOCODB_URL}`);
    console.log(`🔑 API Token: ${apiToken.substring(0, 20)}...`);
    console.log('\n🔄 Restart backend to apply changes:');
    console.log('   docker restart bepsi-pi-development-test');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();