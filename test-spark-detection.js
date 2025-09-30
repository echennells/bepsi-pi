#!/usr/bin/env node

/**
 * Test script to debug Spark payment detection
 * Run this to verify event listeners and polling are working correctly
 */

require('dotenv').config();

async function testSparkDetection() {
  console.log('🧪 Testing Spark Payment Detection\n');
  console.log('=' .repeat(70));

  // Check environment variables
  console.log('📋 Environment Check:');
  const requiredEnvVars = [
    'SPARK_PIN_516_ADDRESS',
    'SPARK_PIN_516_MNEMONIC',
    'SPARK_PIN_516_AMOUNT',
    'SPARK_BEPSITOKEN_IDENTIFIER',
    'SPARK_BEPSITOKEN_PIN_516_AMOUNT'
  ];

  let allEnvVarsPresent = true;
  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar];
    if (!value) {
      console.log(`❌ Missing: ${envVar}`);
      allEnvVarsPresent = false;
    } else {
      console.log(`✅ ${envVar}: ${envVar.includes('MNEMONIC') ? '[HIDDEN]' : value.substring(0, 20) + '...'}`);
    }
  }

  if (!allEnvVarsPresent) {
    console.log('\n⚠️  Some required environment variables are missing!');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(70));
  console.log('🚀 Starting Spark listener test...\n');

  // Import and test the Spark listener
  const { startSparkListener } = require('./src/listeners/sparkL');

  // Monkey-patch dispenseFromPayments to track detections
  const originalDispense = require('./src/machine').dispenseFromPayments;
  let detectionCount = 0;

  require('./src/machine').dispenseFromPayments = function(pinNo, currency) {
    detectionCount++;
    console.log(`\n🎯 PAYMENT DETECTED! Detection #${detectionCount}`);
    console.log(`   Pin: ${pinNo}`);
    console.log(`   Currency: ${currency}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('   ✅ Payment detection is working!\n');

    // Don't actually dispense in test mode
    console.log('   (Skipping actual dispense in test mode)');
  };

  // Start the listener
  try {
    await startSparkListener();

    console.log('\n' + '='.repeat(70));
    console.log('📡 Listener is running. Send test payments to these addresses:\n');

    const pins = [516, 517, 518, 524, 525, 528];
    for (const pin of pins) {
      const address = process.env[`SPARK_PIN_${pin}_ADDRESS`];
      const satsAmount = process.env[`SPARK_PIN_${pin}_AMOUNT`];
      const tokenAmount = process.env[`SPARK_BEPSITOKEN_PIN_${pin}_AMOUNT`];
      const name = process.env[`SPARK_PIN_${pin}_NAME`] || `Pin ${pin}`;

      if (address) {
        console.log(`Pin ${pin} (${name}):`);
        console.log(`  Address: ${address}`);
        console.log(`  Sats: ${satsAmount}`);
        console.log(`  BEPSI: ${tokenAmount}`);
        console.log('');
      }
    }

    console.log('='.repeat(70));
    console.log('⏳ Monitoring for payments... (Press Ctrl+C to stop)\n');

    // Keep the script running
    setInterval(() => {
      process.stdout.write('.');
    }, 5000);

  } catch (error) {
    console.error('❌ Failed to start Spark listener:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down test...');
  process.exit(0);
});

// Run the test
testSparkDetection();