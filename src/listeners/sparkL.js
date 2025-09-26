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

// Get pin configuration from environment variables
const getVendingPins = () => {
  const pinsEnv = process.env.VENDING_PINS || '516,517,518,524,525,528';
  return pinsEnv.split(',').map(pin => parseInt(pin.trim()));
};

const getPinName = (pinNo) => {
  return process.env[`PIN_${pinNo}_NAME`] || `pin ${pinNo}`;
};

const getVendingPinsWithNames = () => {
  const pins = getVendingPins();
  const pinToItem = {};
  pins.forEach(pin => {
    pinToItem[pin] = getPinName(pin);
  });
  return pinToItem;
};

const pinToItem = getVendingPinsWithNames();

// Token configuration from environment variables
const getSupportedTokens = () => {
  const tokens = {};
  const pins = getVendingPins();

  // Get token identifiers from env
  const tokenKeys = process.env.SUPPORTED_TOKEN_KEYS ? process.env.SUPPORTED_TOKEN_KEYS.split(',') : ['BepsiToken'];

  tokenKeys.forEach(tokenKey => {
    const identifier = process.env[`${tokenKey.toUpperCase()}_IDENTIFIER`];
    const name = process.env[`${tokenKey.toUpperCase()}_NAME`] || tokenKey;

    if (identifier) {
      const pinAmounts = {};
      pins.forEach(pin => {
        const amount = parseFloat(process.env[`${tokenKey.toUpperCase()}_PIN_${pin}_AMOUNT`] || '1.0');
        pinAmounts[pin] = amount;
      });

      tokens[tokenKey] = {
        identifier,
        name,
        pinAmounts
      };
    }
  });

  return tokens;
};

const SUPPORTED_TOKENS = getSupportedTokens();


// Store payment addresses for each pin
const pinPaymentAddresses = new Map();
// Store separate wallet for each pin
const pinWallets = new Map();
// Track pins currently processing payments to prevent double-dispensing
const processingPayments = new Set();
// Track recent successful payments to prevent immediate sweeping
const recentPayments = new Map(); // pinNo -> timestamp

// Track previous balances to detect INCREASES only
const previousSatsBalances = new Map();
const previousTokenBalances = new Map();
// Track if we've done the initial balance scan to avoid false positives on startup
let initialBalanceScanComplete = false;

// Get environment variables for each pin
const getPinConfig = (pinNo) => {
  const address = process.env[`SPARK_PIN_${pinNo}_ADDRESS`];
  const mnemonic = process.env[`SPARK_PIN_${pinNo}_MNEMONIC`];

  if (!address || !mnemonic) {
    throw new Error(`Missing environment variables for pin ${pinNo}. Need SPARK_PIN_${pinNo}_ADDRESS and SPARK_PIN_${pinNo}_MNEMONIC`);
  }

  return { address, mnemonic };
};

const getTreasuryAddress = () => {
  const address = process.env.SPARK_TREASURY_ADDRESS;

  if (!address) {
    console.log("[Spark] Treasury consolidation disabled - missing SPARK_TREASURY_ADDRESS");
    return null;
  }

  return address;
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

    // Get pin-specific sats amount, fallback to default
    const pinSpecificAmount = process.env[`SPARK_PIN_${pinNo}_AMOUNT`];
    const amount = pinSpecificAmount ? parseInt(pinSpecificAmount) : (parseInt(process.env.SPARK_PAYMENT_AMOUNT) || 1000);

    const paymentRequest = {
      pinNo,
      address: sparkAddress,
      amount: amount,
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

      // Get previous balance
      const previousSats = previousSatsBalances.get(pinNo) || 0;

      // Check for satoshi payment INCREASE (but not on initial scan)
      if (currentSatsNum >= requiredAmount && currentSatsNum > previousSats && initialBalanceScanComplete) {
        // Mark as processing immediately to prevent double-processing
        processingPayments.add(pinNo);

        console.log(`[Spark] ✅ PAYMENT DETECTED for pin ${pinNo}!`);
        console.log(`[Spark] - New balance: ${currentSatsNum} sats (was ${previousSats})`);
        console.log(`[Spark] - Increase: ${currentSatsNum - previousSats} sats`);
        console.log(`[Spark] - Required: ${requiredAmount} sats`);
        console.log(`[Spark] - Address: ${paymentRequest.address}`);

        // Update stored balance
        previousSatsBalances.set(pinNo, currentSatsNum);

        // Track this payment to delay sweeping
        recentPayments.set(pinNo, Date.now());

        // Dispense the product
        console.log(`[Spark] 🥤 Dispensing for pin ${pinNo}...`);
        dispenseFromPayments(pinNo, "spark");

        // Clear processing flag after a delay
        setTimeout(() => processingPayments.delete(pinNo), 10000);
        continue;
      }

      // Always update the tracked balance even if no payment
      previousSatsBalances.set(pinNo, currentSatsNum);

      // Check for token payments - use tokenBalances from the balance we already fetched

      // Check tokens in the tokenBalances Map
      for (const [tokenKey, tokenConfig] of Object.entries(SUPPORTED_TOKENS)) {
        try {
          const requiredTokenAmount = tokenConfig.pinAmounts[pinNo];

          // Skip if this pin doesn't have a configured token amount
          if (!requiredTokenAmount) {
            continue;
          }

          // Get token amount (0 if token doesn't exist in wallet)
          let tokenAmount = 0;
          if (currentBalance.tokenBalances.has(tokenConfig.identifier)) {
            const tokenData = currentBalance.tokenBalances.get(tokenConfig.identifier);
            if (tokenData && tokenData.balance) {
              const rawBalance = BigInt(tokenData.balance);
              // BEPSI tokens have 6 decimals - hardcode since blockchain metadata is wrong
              const decimals = 6; // tokenData.decimals is returning 0, but BEPSI has 6 decimals
              const divisor = Math.pow(10, decimals);
              tokenAmount = Number(rawBalance) / divisor;
            }
          }


          // Get previous token balance for this pin and token
          const tokenBalanceKey = `${pinNo}_${tokenConfig.identifier}`;
          const previousTokenAmount = previousTokenBalances.get(tokenBalanceKey) || 0;

          // Check for token payment INCREASE (but not on initial scan)
          const paymentAmount = tokenAmount - previousTokenAmount;
          if (paymentAmount >= requiredTokenAmount && tokenAmount > previousTokenAmount && !isNaN(tokenAmount) && initialBalanceScanComplete) {
            // Mark as processing immediately to prevent double-processing
            processingPayments.add(pinNo);

            console.log(`[Spark] ✅ TOKEN PAYMENT DETECTED for pin ${pinNo}!`);
            console.log(`[Spark] - Token: ${tokenConfig.name}`);
            console.log(`[Spark] - New balance: ${tokenAmount} (was ${previousTokenAmount})`);
            console.log(`[Spark] - Increase: ${tokenAmount - previousTokenAmount} tokens`);
            console.log(`[Spark] - Required: ${requiredTokenAmount}`);
            console.log(`[Spark] - Address: ${paymentRequest.address}`);

            // Update stored token balance
            previousTokenBalances.set(tokenBalanceKey, tokenAmount);

            // Track this payment to delay sweeping
            recentPayments.set(pinNo, Date.now());

            // Dispense the product
            console.log(`[Spark] 🥤 Dispensing for pin ${pinNo}...`);
            dispenseFromPayments(pinNo, "spark");

            // Clear processing flag after a delay
            setTimeout(() => processingPayments.delete(pinNo), 10000);
            break;
          }

          // Always update the tracked token balance even if no payment
          previousTokenBalances.set(tokenBalanceKey, tokenAmount);
        } catch (tokenError) {
          // Token balance check failed, continue to next token
          console.error(`[Spark] Error checking ${tokenConfig.name} balance for pin ${pinNo}:`, tokenError.message);
        }
      }
    }

    // Mark initial scan as complete after first full cycle
    if (!initialBalanceScanComplete) {
      initialBalanceScanComplete = true;
      console.log('[Spark] Initial balance scan complete - now monitoring for payments');
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

// Sweep all funds from all pin wallets to treasury
const sweepAllFundsToTreasury = async () => {
  const treasuryAddress = getTreasuryAddress();
  if (!treasuryAddress) {
    console.log(`[Spark] Treasury not configured, skipping sweep`);
    return;
  }

  // Sweep from each pin wallet
  const allPins = getVendingPins();

  for (const pinNo of allPins) {
    try {
      const pinWallet = await createSparkWalletForPin(pinNo);
      const balance = await pinWallet.getBalance();
      const availableSats = Number(balance.balance);

      // Check and sweep sats
      if (availableSats > 100) {
        try {
          await pinWallet.transfer({
            receiverSparkAddress: treasuryAddress,
            amountSats: availableSats
          });
          console.log(`[Spark] ✅ Swept ${availableSats} sats from pin ${pinNo}`);
        } catch (err) {
          console.error(`[Spark] ❌ Failed to sweep ${availableSats} sats from pin ${pinNo}:`, err.message);
        }
      }

      // Check and sweep tokens
      if (balance.tokenBalances && balance.tokenBalances.size > 0) {
        for (const [tokenId, tokenData] of balance.tokenBalances) {
          try {
            const rawAmount = BigInt(tokenData.balance);
            if (rawAmount > 0n) {
              const decimals = tokenData.decimals || 0;
              const divisor = Math.pow(10, decimals);
              const tokenAmount = Number(rawAmount) / divisor;

              await pinWallet.transferTokens({
                tokenIdentifier: tokenId,
                tokenAmount: rawAmount,
                receiverSparkAddress: treasuryAddress
              });

              console.log(`[Spark] ✅ Swept ${tokenAmount} tokens from pin ${pinNo}`);
            }
          } catch (tokenErr) {
            console.error(`[Spark] ❌ Failed to sweep tokens from pin ${pinNo}:`, tokenErr.message);
          }
        }
      }
    } catch (error) {
      console.error(`[Spark] Error checking pin ${pinNo}:`, error.message);
    }
  }

  // Only log if something was actually swept
  console.log(`[Spark] Fund sweep complete`);
};

const startSparkListener = async () => {
  console.log("[Spark] Starting Spark payment listener...");

  try {
    // Load pre-generated payment addresses for all vending machine pins
    const availablePins = getVendingPins(); // Get pins from environment

    console.log("[Spark] Loading pre-generated wallets for each pin...");
    for (const pinNo of availablePins) {
      try {
        const { address } = getPinConfig(pinNo);

        // Initialize the wallet (this verifies the mnemonic works)
        await createSparkWalletForPin(pinNo);

        // Get pin-specific sats amount, fallback to default
        const pinSpecificAmount = process.env[`SPARK_PIN_${pinNo}_AMOUNT`];
        const amount = pinSpecificAmount ? parseInt(pinSpecificAmount) : (parseInt(process.env.SPARK_PAYMENT_AMOUNT) || 1000);

        const paymentRequest = {
          pinNo,
          address: address, // Use pre-generated address
          amount: amount
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

    // Check if treasury is configured
    const treasuryAddress = getTreasuryAddress();
    if (treasuryAddress) {
      console.log(`[Spark] Treasury consolidation enabled: ${treasuryAddress}`);

      // Start periodic fund sweep every 10 minutes
      setInterval(() => {
        sweepAllFundsToTreasury();
      }, 10 * 60 * 1000); // 10 minutes
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