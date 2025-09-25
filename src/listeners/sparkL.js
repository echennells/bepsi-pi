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

// Import pinToItem mapping from machine.js
const pinToItem = {
  516: "coke",
  517: "iced tea",
  518: "poppi",
  524: "bubbly",
  525: "cooler",
  528: "beer"
};

// Token configuration - pin-specific amounts
const SUPPORTED_TOKENS = {
  'BepsiToken': {
    identifier: 'btkn1xecvlqngfwwvw2z38s67rn23r76m2vpkmwavfr9cr6ytzgqufu0ql0a4qk',
    name: 'Bepsi Token',
    pinAmounts: {
      516: 1.0, // coke - 1 token
      517: 1.0, // iced tea - 1 token
      518: 1.0, // poppi - 1 token
      524: 1.0, // bubbly - 1 token
      525: 2.0, // cooler - 2 tokens (alcoholic)
      528: 2.0  // beer - 2 tokens (alcoholic)
    }
  }
};

// Treasury wallet for fund consolidation
let treasuryWallet = null;

// Store payment addresses for each pin
const pinPaymentAddresses = new Map();
// Store separate wallet for each pin
const pinWallets = new Map();
// Track pins currently processing payments to prevent double-dispensing
const processingPayments = new Set();

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

const checkForPayments = async () => {
  try {
    // Check each pin wallet for payments
    for (const [pinNo, paymentRequest] of pinPaymentAddresses) {
      // Skip if this pin is already processing a payment
      if (processingPayments.has(pinNo)) {
        continue;
      }

      const wallet = await createSparkWalletForPin(pinNo);
      const currentBalance = await wallet.getBalance();
      const currentSatsNum = Number(currentBalance.balance);
      const requiredAmount = parseInt(paymentRequest.amount);

      // Check for satoshi payments
      if (currentSatsNum >= requiredAmount) {
        // Mark as processing immediately to prevent double-processing
        processingPayments.add(pinNo);

        console.log(`[Spark] ✅ PAYMENT DETECTED for pin ${pinNo}!`);
        console.log(`[Spark] - Balance: ${currentSatsNum} sats`);
        console.log(`[Spark] - Required: ${requiredAmount} sats`);
        console.log(`[Spark] - Address: ${paymentRequest.address}`);

        // Dispense the product
        console.log(`[Spark] 🥤 Dispensing for pin ${pinNo}...`);
        dispenseFromPayments(pinNo, "spark");

        // Consolidate ALL funds immediately after dispensing
        setTimeout(() => consolidateAllFunds(pinNo), 5000);
        continue;
      }

      // Check for token payments
      for (const [tokenKey, tokenConfig] of Object.entries(SUPPORTED_TOKENS)) {
        try {
          const tokenBalance = await wallet.getTokenBalance(tokenConfig.identifier);

          // Debug the raw token balance response
          console.log(`[Spark] DEBUG - Pin ${pinNo} raw token response:`, JSON.stringify(tokenBalance, null, 2));

          // Handle different possible response formats
          let rawBalance, decimals;
          if (typeof tokenBalance === 'object' && tokenBalance !== null) {
            rawBalance = tokenBalance.balance || tokenBalance.amount || '0';
            decimals = tokenBalance.decimals || 0;
          } else {
            rawBalance = '0';
            decimals = 0;
          }

          const tokenAmount = parseFloat(rawBalance) / Math.pow(10, decimals);
          const requiredTokenAmount = tokenConfig.pinAmounts[pinNo];

          // Skip if this pin doesn't have a configured token amount
          if (!requiredTokenAmount) {
            continue;
          }

          console.log(`[Spark] DEBUG - Pin ${pinNo} ${tokenConfig.name}: rawBalance=${rawBalance}, decimals=${decimals}, tokenAmount=${tokenAmount}, required=${requiredTokenAmount}`);

          if (tokenAmount >= requiredTokenAmount && !isNaN(tokenAmount)) {
            // Mark as processing immediately to prevent double-processing
            processingPayments.add(pinNo);

            console.log(`[Spark] ✅ TOKEN PAYMENT DETECTED for pin ${pinNo}!`);
            console.log(`[Spark] - Token: ${tokenConfig.name}`);
            console.log(`[Spark] - Balance: ${tokenAmount}`);
            console.log(`[Spark] - Required: ${requiredTokenAmount}`);
            console.log(`[Spark] - Address: ${paymentRequest.address}`);

            // Dispense the product
            console.log(`[Spark] 🥤 Dispensing for pin ${pinNo}...`);
            dispenseFromPayments(pinNo, "spark");

            // Consolidate ALL funds immediately after dispensing
            setTimeout(() => consolidateAllFunds(pinNo), 5000);
            break;
          }
        } catch (tokenError) {
          // Token balance check failed, continue to next token
          console.error(`[Spark] Error checking ${tokenConfig.name} balance for pin ${pinNo}:`, tokenError.message);
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

const consolidateAllFunds = async (pinNo) => {
  try {
    const treasury = await createTreasuryWallet();
    if (!treasury) {
      console.log(`[Spark] Treasury not configured, skipping consolidation for pin ${pinNo}`);
      // Clear processing flag even if treasury not configured
      processingPayments.delete(pinNo);
      return;
    }

    const pinWallet = await createSparkWalletForPin(pinNo);
    const balance = await pinWallet.getBalance();
    const availableSats = Number(balance.balance);

    // Transfer all satoshis (no fee reserve needed)
    if (availableSats > 0) {
      console.log(`[Spark] 💰 Consolidating ${availableSats} sats from pin ${pinNo} to treasury...`);

      const result = await pinWallet.transfer({
        receiverSparkAddress: treasury.sparkAddress,
        amountSats: availableSats
      });

      console.log(`[Spark] ✅ Consolidation complete: ${availableSats} sats transferred`);
    }

    // Also consolidate tokens
    for (const [tokenKey, tokenConfig] of Object.entries(SUPPORTED_TOKENS)) {
      try {
        const tokenBalance = await pinWallet.getTokenBalance(tokenConfig.identifier);
        const tokenAmount = parseFloat(tokenBalance.balance);

        if (tokenAmount > 0) {
          console.log(`[Spark] 💰 Consolidating ${tokenAmount / Math.pow(10, tokenBalance.decimals || 0)} ${tokenConfig.name} from pin ${pinNo} to treasury...`);

          const tokenResult = await pinWallet.transferToken({
            receiverSparkAddress: treasury.sparkAddress,
            tokenId: tokenConfig.identifier,
            amount: tokenAmount
          });

          console.log(`[Spark] ✅ Token consolidation complete: ${tokenConfig.name} transferred`);
        }
      } catch (tokenError) {
        if (!tokenError.message?.includes('not found')) {
          console.error(`[Spark] Token consolidation failed for ${tokenConfig.name}:`, tokenError.message);
        }
      }
    }

    // Clear the processing flag after successful consolidation
    processingPayments.delete(pinNo);
    console.log(`[Spark] Pin ${pinNo} ready for new payments`);

  } catch (error) {
    console.error(`[Spark] Consolidation failed for pin ${pinNo}:`, error.message);
    // Clear the processing flag even on error so the pin isn't stuck
    processingPayments.delete(pinNo);
  }
};

const startSparkListener = async () => {
  console.log("[Spark] Starting Spark payment listener...");

  try {
    // Load pre-generated payment addresses for all vending machine pins
    const availablePins = [516, 517, 518, 524, 525, 528]; // Real drink pins

    console.log("[Spark] Loading pre-generated wallets for each pin...");
    for (const pinNo of availablePins) {
      try {
        const { address } = getPinConfig(pinNo);

        // Initialize the wallet (this verifies the mnemonic works)
        await createSparkWalletForPin(pinNo);

        const paymentRequest = {
          pinNo,
          address: address, // Use pre-generated address
          amount: SPARK_PAYMENT_AMOUNT || 1000
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

    // Show supported tokens
    if (Object.keys(SUPPORTED_TOKENS).length > 0) {
      console.log(`[Spark] 🪙 Accepted tokens:`);
      for (const [tokenKey, tokenConfig] of Object.entries(SUPPORTED_TOKENS)) {
        console.log(`[Spark] - ${tokenConfig.name} requirements:`);
        for (const [pinNo, amount] of Object.entries(tokenConfig.pinAmounts)) {
          const drinkName = pinToItem[pinNo] || `pin ${pinNo}`;
          console.log(`[Spark]   Pin ${pinNo} (${drinkName}): ${amount} tokens`);
        }
      }
    }

    // Start monitoring for payments
    monitorPayments();

    // Initialize treasury wallet if configured
    const treasury = await createTreasuryWallet();
    if (treasury) {
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