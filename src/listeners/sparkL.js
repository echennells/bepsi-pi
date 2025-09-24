// Dynamic import for ES modules in CommonJS context
let IssuerSparkWallet;

async function loadSparkSDK() {
  if (!IssuerSparkWallet) {
    const module = await import("@buildonspark/issuer-sdk");
    IssuerSparkWallet = module.IssuerSparkWallet;
  }
  return IssuerSparkWallet;
}
const { dispenseFromPayments } = require("../machine");
const { SPARK_PAYMENT_AMOUNT } = require("../env");

// Treasury wallet for fund consolidation
let treasuryWallet = null;

// Store payment addresses for each pin
const pinPaymentAddresses = new Map();
// Store separate wallet for each pin
const pinWallets = new Map();

// Get environment variables for each pin
const getPinConfig = (pinNo) => {
  const address = process.env[`SPARK_PIN_${pinNo}_ADDRESS`];
  const mnemonic = process.env[`SPARK_PIN_${pinNo}_MNEMONIC`];

  if (!address || !mnemonic) {
    throw new Error(`Missing environment variables for pin ${pinNo}. Need SPARK_PIN_${pinNo}_ADDRESS and SPARK_PIN_${pinNo}_MNEMONIC`);
  }

  return { address, mnemonic };
};

const getTreasuryConfig = () => {
  const address = process.env.SPARK_TREASURY_ADDRESS;
  const mnemonic = process.env.SPARK_TREASURY_MNEMONIC;

  if (!address || !mnemonic) {
    console.log("[Spark] Treasury consolidation disabled - missing SPARK_TREASURY_ADDRESS or SPARK_TREASURY_MNEMONIC");
    return null;
  }

  return { address, mnemonic };
};

const createTreasuryWallet = async () => {
  if (treasuryWallet) {
    return treasuryWallet;
  }

  const treasuryConfig = getTreasuryConfig();
  if (!treasuryConfig) {
    return null;
  }

  try {
    const SparkWallet = await loadSparkSDK();
    const { mnemonic } = treasuryConfig;

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: mnemonic,
      options: {
        network: "MAINNET",
      },
    });

    treasuryWallet = wallet;
    console.log(`[Spark] Treasury wallet initialized: ${wallet.sparkAddress}`);
    return treasuryWallet;
  } catch (error) {
    console.error(`Failed to create treasury wallet:`, error.message);
    return null;
  }
};

const createSparkWalletForPin = async (pinNo) => {
  if (pinWallets.has(pinNo)) {
    return pinWallets.get(pinNo);
  }

  try {
    const SparkWallet = await loadSparkSDK();
    const { mnemonic } = getPinConfig(pinNo);

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: mnemonic,
      options: {
        network: "MAINNET",
      },
    });

    pinWallets.set(pinNo, wallet);
    console.log(`[Spark] Initialized wallet for pin ${pinNo}: ${wallet.sparkAddress}`);
    return wallet;
  } catch (error) {
    console.error(`Failed to create Spark wallet for pin ${pinNo}:`, error.message);
    throw error;
  }
};

const getPaymentAddressForPin = async (pinNo) => {
  try {
    const wallet = await createSparkWalletForPin(pinNo);

    // For now, we'll use the same wallet address for all pins
    // In a more sophisticated setup, you might derive different addresses per pin
    const sparkAddress = wallet.sparkAddress;

    const paymentRequest = {
      pinNo,
      address: sparkAddress,
      amount: SPARK_PAYMENT_AMOUNT || 1000,
      createdAt: Date.now()
    };

    pinPaymentAddresses.set(pinNo, paymentRequest);

    console.log(`[Spark] Payment address for pin ${pinNo}: ${sparkAddress}`);
    console.log(`[Spark] Expected amount: ${paymentRequest.amount} sats`);

    return paymentRequest;

  } catch (error) {
    console.error(`[Spark] Failed to get payment address for pin ${pinNo}:`, error.message);
    throw error;
  }
};

// Store wallet balance to detect payments
let lastKnownBalance = 0;
const expectedPayments = new Map(); // Map of expected amounts to pin numbers

const checkForPayments = async () => {
  console.log(`[Spark] Checking for payments on ${pinPaymentAddresses.size} pins...`);
  try {
    // Check each pin wallet for payments
    for (const [pinNo, paymentRequest] of pinPaymentAddresses) {
      const wallet = await createSparkWalletForPin(pinNo);
      const currentBalance = await wallet.getBalance();
      const currentSats = currentBalance.balance;

      console.log(`[Spark] DEBUG - Pin ${pinNo}: current=${Number(currentSats)}, last=${Number(paymentRequest.lastKnownBalance || 0)}`);

      // Initialize balance for this pin if first time
      if (!paymentRequest.lastKnownBalance) {
        paymentRequest.lastKnownBalance = currentSats;
        console.log(`[Spark] DEBUG - Pin ${pinNo}: Initialized with balance ${Number(currentSats)} sats`);
        continue;
      }

      // Check if this pin's balance increased (handle BigInt properly)
      const currentSatsNum = Number(currentSats);
      const lastKnownNum = Number(paymentRequest.lastKnownBalance || 0n);
      const balanceIncrease = currentSatsNum - lastKnownNum;

      if (balanceIncrease > 0) {
        console.log(`[Spark] Payment received for pin ${pinNo}! Balance increased by ${balanceIncrease} sats`);
        console.log(`[Spark] DEBUG - Pin ${pinNo} current balance: ${currentSatsNum} sats`);
        console.log(`[Spark] DEBUG - Pin ${pinNo} last known balance: ${lastKnownNum} sats`);

        const expectedAmount = parseInt(paymentRequest.amount);
        console.log(`[Spark] DEBUG - Comparing ${balanceIncrease} >= ${expectedAmount} (${balanceIncrease >= expectedAmount})`);

        if (balanceIncrease >= expectedAmount) {
          console.log(`[Spark] ✅ PAYMENT CONFIRMED for pin ${pinNo}!`);
          console.log(`[Spark] - Expected: ${expectedAmount} sats`);
          console.log(`[Spark] - Received: ${balanceIncrease} sats`);
          console.log(`[Spark] - Address: ${paymentRequest.address}`);

          // Update balance but keep the payment request active (permanent)
          paymentRequest.lastKnownBalance = currentSats;

          // Dispense the product
          console.log(`[Spark] 🥤 Triggering dispensing for pin ${pinNo}...`);
          dispenseFromPayments(pinNo, "spark");

          // Schedule fund consolidation after successful payment
          setTimeout(() => consolidateFunds(pinNo), 10000); // Consolidate 10 seconds after payment
        } else {
          // Update balance even if amount doesn't match (partial payment)
          paymentRequest.lastKnownBalance = currentSats;
          console.log(`[Spark] ⚠️  Payment too small for pin ${pinNo}: received ${balanceIncrease}, need ${expectedAmount}`);
        }
      }
    }

  } catch (error) {
    console.error(`[Spark] Error checking for payments:`, error.message);
  }
};

const monitorPayments = async () => {
  const checkInterval = 5000; // Check every 5 seconds

  setInterval(async () => {
    await checkForPayments();
  }, checkInterval);
};

const consolidateFunds = async (pinNo) => {
  try {
    const treasury = await createTreasuryWallet();
    if (!treasury) {
      console.log(`[Spark] Treasury not configured, skipping consolidation for pin ${pinNo}`);
      return;
    }

    const pinWallet = await createSparkWalletForPin(pinNo);
    const balance = await pinWallet.getBalance();
    const availableSats = Number(balance.balance);

    // Only consolidate if there's a meaningful amount (more than 500 sats to cover potential fees)
    const minConsolidationAmount = 500;
    if (availableSats < minConsolidationAmount) {
      console.log(`[Spark] Pin ${pinNo} balance too low for consolidation: ${availableSats} sats`);
      return;
    }

    console.log(`[Spark] 💰 Starting consolidation for pin ${pinNo}: ${availableSats} sats -> ${treasury.sparkAddress}`);

    // Send most of the balance to treasury, keeping a small amount for fees
    const amountToSend = availableSats - 100; // Keep 100 sats for fees

    if (amountToSend <= 0) {
      console.log(`[Spark] Not enough balance after fee reserve for pin ${pinNo}`);
      return;
    }

    // Execute the transfer
    const result = await pinWallet.transfer({
      receiverSparkAddress: treasury.sparkAddress,
      amountSats: amountToSend
    });

    console.log(`[Spark] ✅ Consolidation successful for pin ${pinNo}:`);
    console.log(`[Spark] - Amount: ${amountToSend} sats`);
    console.log(`[Spark] - Transaction: ${result.txId || result.transactionId || 'completed'}`);

    // Update the pin's known balance after consolidation
    const paymentRequest = pinPaymentAddresses.get(pinNo);
    if (paymentRequest) {
      paymentRequest.lastKnownBalance = 100; // Remaining fee reserve
    }

  } catch (error) {
    console.error(`[Spark] Consolidation failed for pin ${pinNo}:`, error.message);
  }
};

const cleanupExpiredPaymentRequests = () => {
  const cleanupInterval = 60000; // Check every minute
  const expiryTime = 10 * 60 * 1000; // 10 minutes

  setInterval(() => {
    const now = Date.now();
    for (const [pinNo, paymentRequest] of pinPaymentAddresses) {
      // Don't clean up permanent payment requests
      if (paymentRequest.permanent) continue;

      if (now - paymentRequest.createdAt > expiryTime) {
        console.log(`[Spark] Cleaning up expired payment request for pin ${pinNo}`);
        pinPaymentAddresses.delete(pinNo);
      }
    }
  }, cleanupInterval);
};

const schedulePeriodicConsolidation = () => {
  const consolidationInterval = 30 * 60 * 1000; // Check every 30 minutes

  setInterval(async () => {
    console.log("[Spark] Running periodic consolidation check...");

    for (const [pinNo] of pinPaymentAddresses) {
      try {
        await consolidateFunds(pinNo);
      } catch (error) {
        console.error(`[Spark] Periodic consolidation error for pin ${pinNo}:`, error.message);
      }
    }
  }, consolidationInterval);
};

const startSparkListener = async () => {
  console.log("[Spark] Starting Spark payment listener...");

  try {
    // Load pre-generated payment addresses for all vending machine pins
    const availablePins = [4, 5, 6, 12, 13, 16]; // From machine.js pinToItem mapping

    console.log("[Spark] Loading pre-generated wallets for each pin...");
    for (const pinNo of availablePins) {
      try {
        const { address } = getPinConfig(pinNo);

        // Initialize the wallet (this verifies the mnemonic works)
        await createSparkWalletForPin(pinNo);

        const paymentRequest = {
          pinNo,
          address: address, // Use pre-generated address
          amount: SPARK_PAYMENT_AMOUNT || 1000,
          createdAt: Date.now(),
          permanent: true, // Mark as permanent so it never expires
          lastKnownBalance: 0 // Track balance for this specific wallet
        };

        pinPaymentAddresses.set(pinNo, paymentRequest);
        console.log(`[Spark] Pin ${pinNo}: Send ${paymentRequest.amount} sats to ${address}`);

      } catch (error) {
        console.error(`[Spark] Failed to load pin ${pinNo}:`, error.message);
      }
    }

    console.log(`[Spark] 🎯 Vending machine ready! Each pin has unique address:`);
    for (const [pinNo, paymentRequest] of pinPaymentAddresses) {
      console.log(`[Spark] Pin ${pinNo}: ${paymentRequest.address}`);
    }

    // Start monitoring for payments
    monitorPayments();

    // Start periodic consolidation if treasury is configured
    const treasury = await createTreasuryWallet();
    if (treasury) {
      schedulePeriodicConsolidation();
      console.log("[Spark] Treasury consolidation enabled");
    }

    console.log("[Spark] Spark payment listener started successfully");

  } catch (error) {
    console.error("[Spark] Failed to start Spark listener:", error.message);

    // Retry connection after a delay
    const reconnectInterval = 60000; // 1 minute
    console.log(`[Spark] Retrying connection in ${reconnectInterval / 1000} seconds...`);
    setTimeout(startSparkListener, reconnectInterval);
  }
};

module.exports = {
  startSparkListener,
  getPaymentAddressForPin,
};