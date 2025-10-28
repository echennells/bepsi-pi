#!/usr/bin/env node

/**
 * Automated NocoDB v2 setup for vending machine
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const NOCODB_URL = 'http://localhost:8080';
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

async function getAuthToken() {
  console.log('🔐 Getting auth token...');

  try {
    // Try signing in first
    let response;
    try {
      response = await axios.post(`${NOCODB_URL}/api/v2/auth/user/signin`, {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      });
    } catch (signInError) {
      // If sign in fails, try creating user
      console.log('👤 Creating admin user...');
      response = await axios.post(`${NOCODB_URL}/api/v2/auth/user/signup`, {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        firstname: 'Admin',
        lastname: 'User'
      });
    }

    return response.data.token;
  } catch (error) {
    throw new Error(`Auth failed: ${error.response?.data?.msg || error.message}`);
  }
}

async function createWorkspaceAndBase(token) {
  console.log('🏢 Setting up workspace and base...');

  try {
    // List existing workspaces
    const workspaces = await axios.get(`${NOCODB_URL}/api/v2/workspaces`, {
      headers: { 'xc-auth': token }
    });

    console.log(`Found ${workspaces.data.list?.length || 0} workspaces`);

    let workspaceId;
    if (workspaces.data.list && workspaces.data.list.length > 0) {
      workspaceId = workspaces.data.list[0].id;
      console.log(`Using existing workspace: ${workspaceId}`);
    } else {
      // Create workspace
      const workspace = await axios.post(`${NOCODB_URL}/api/v2/workspaces`, {
        title: 'VendingMachine'
      }, {
        headers: { 'xc-auth': token }
      });
      workspaceId = workspace.data.id;
      console.log(`Created workspace: ${workspaceId}`);
    }

    // Create base
    const base = await axios.post(`${NOCODB_URL}/api/v2/workspaces/${workspaceId}/bases`, {
      title: 'bepsi',
      type: 'database'
    }, {
      headers: { 'xc-auth': token }
    });

    console.log(`✅ Created base: ${base.data.id}`);
    return { workspaceId, baseId: base.data.id };

  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.msg?.includes('already exists')) {
      console.log('📦 Base may already exist, continuing...');
      return { workspaceId: 'default', baseId: 'default' };
    }
    throw new Error(`Workspace/Base creation failed: ${error.response?.data?.msg || error.message}`);
  }
}

async function updateBackendEnv(token) {
  console.log('⚙️ Updating backend environment...');

  const envPath = path.join(__dirname, '../docker-test.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  envContent = envContent.replace(
    /NOCODB_API_TOKEN=.*/,
    `NOCODB_API_TOKEN=${token}`
  );

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Environment updated!');
}

async function main() {
  try {
    await waitForNocoDB();
    const token = await getAuthToken();

    console.log(`✅ Got auth token: ${token.substring(0, 20)}...`);

    // Try to set up workspace/base
    try {
      await createWorkspaceAndBase(token);
    } catch (error) {
      console.log(`⚠️ Workspace setup failed: ${error.message}`);
      console.log('📝 Continuing with token update...');
    }

    await updateBackendEnv(token);

    console.log('\n🎉 Setup complete!');
    console.log(`🔑 API Token: ${token.substring(0, 20)}...`);
    console.log('\n📝 Manual steps still needed:');
    console.log('1. Open http://localhost:8080');
    console.log('2. Create base "bepsi" if not exists');
    console.log('3. Create table "purchases" with columns: id, currency, timestamp, item');
    console.log('4. Restart backend container');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();