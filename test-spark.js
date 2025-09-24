const { getPaymentAddressForPin } = require("./src/listeners/sparkL");

async function testSparkIntegration() {
  console.log("🧪 Testing Spark Integration");
  console.log("============================");

  try {
    // Test creating payment request for pin 4 (lime)
    const pinNo = 4;
    console.log(`\n📋 Creating payment request for pin ${pinNo}...`);

    const paymentRequest = await getPaymentAddressForPin(pinNo);

    console.log(`\n💰 Payment Details:`);
    console.log(`   Pin: ${paymentRequest.pinNo}`);
    console.log(`   Address: ${paymentRequest.address}`);
    console.log(`   Amount: ${paymentRequest.amount} sats`);
    console.log(`   Created: ${new Date(paymentRequest.createdAt).toISOString()}`);

    console.log(`\n📱 To test payment:`);
    console.log(`   1. Send ${paymentRequest.amount} sats to: ${paymentRequest.address}`);
    console.log(`   2. Watch the bepsi-pi logs for payment detection`);
    console.log(`   3. Look for: "[Spark] ✅ PAYMENT CONFIRMED for pin ${pinNo}!"`);
    console.log(`   4. Should trigger: "[Spark] 🥤 Triggering dispensing for pin ${pinNo}..."`);

    console.log(`\n🔍 Expected log sequence:`);
    console.log(`   [Spark] Payment received! Balance increased by ${paymentRequest.amount} sats`);
    console.log(`   [Spark] ✅ PAYMENT CONFIRMED for pin ${pinNo}!`);
    console.log(`   [Spark] - Expected: ${paymentRequest.amount} sats`);
    console.log(`   [Spark] - Received: ${paymentRequest.amount} sats`);
    console.log(`   [Spark] - Will dispense from pin ${pinNo}`);
    console.log(`   [Spark] 🥤 Triggering dispensing for pin ${pinNo}...`);

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.log("\n🔧 Troubleshooting:");
    console.log("   - Make sure SPARK_MNEMONIC is set in .env");
    console.log("   - Verify the mnemonic is valid");
    console.log("   - Check network connectivity");
  }
}

// Run test if called directly
if (require.main === module) {
  testSparkIntegration();
}

module.exports = { testSparkIntegration };