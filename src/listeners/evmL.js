const { ethers } = require("ethers");
const abiDecoder = require("abi-decoder");
const { dispenseFromPayments, logPayment } = require("../machine");
const { VENDOR_SELECTION_TO_PIN_MAPPING, NETWORKS } = require("../constants");
const {
  match,
  contains,
  isPaymentValid,
  getStablecoinName,
  parseStablecoin,
  randomPin,
} = require("../common");
const { PAYMENT_ADDRESS } = require("../env");

const tokenAbi = require("../abi/erc20.json");
abiDecoder.addABI(tokenAbi);

const handleStablecoinPayments = async (from, amount, network, stablecoin) => {
  console.log(`[EVM] 🔍 Processing payment...`);

  // Parse and format the amount for logging
  const formattedAmount = ethers.utils.formatUnits(amount, stablecoin.decimals);
  console.log(`[EVM] 💵 Formatted amount: ${formattedAmount} ${stablecoin.symbol}`);

  // Check minimum amount (1 token)
  const minAmount = ethers.utils.parseUnits("1", stablecoin.decimals);
  console.log(`[EVM] 📏 Minimum required: 1 ${stablecoin.symbol}`);

  if (ethers.BigNumber.from(amount).lt(minAmount)) {
    console.log(`[EVM] ❌ PAYMENT REJECTED: Insufficient amount`);
    console.log(`[EVM]    - Received: ${formattedAmount} ${stablecoin.symbol}`);
    console.log(`[EVM]    - Required: 1 ${stablecoin.symbol}`);
    console.log(`[EVM]    - From: ${from}`);
    console.log(`[EVM]    - Network: ${network.name}`);
    return;
  }

  // Extract selection from last digit of amount
  const amountString = amount.toString();
  const lastDigit = amountString.slice(-1);
  const selection = parseInt(lastDigit, 10); // Use base 10, not hex
  console.log(`[EVM] 🎯 Selection extraction:`);
  console.log(`[EVM]    - Raw amount: ${amountString}`);
  console.log(`[EVM]    - Last digit: ${lastDigit}`);
  console.log(`[EVM]    - Parsed selection: ${selection}`);

  // Map selection to pin
  let pin = VENDOR_SELECTION_TO_PIN_MAPPING[selection];
  console.log(`[EVM] 📍 Pin mapping:`);
  console.log(`[EVM]    - Selection ${selection} → Pin ${pin}`);

  if (Number.isNaN(pin) || pin === undefined) {
    console.log(`[EVM] ⚠️  Invalid selection ${selection}, using random pin`);
    pin = randomPin();
    console.log(`[EVM]    - Random pin selected: ${pin}`);
  }

  console.log(`[EVM] ✅ PAYMENT ACCEPTED!`);
  console.log(`[EVM] 📦 Payment Summary:`);
  console.log(`[EVM]    - Amount: ${formattedAmount} ${stablecoin.symbol}`);
  console.log(`[EVM]    - Network: ${network.name}`);
  console.log(`[EVM]    - From: ${from}`);
  console.log(`[EVM]    - Selection: ${selection}`);
  console.log(`[EVM]    - Pin: ${pin}`);
  console.log(`[EVM] 🥤 Dispensing pin ${pin}...`);

  try {
    const numericAmount = parseFloat(formattedAmount);
    logPayment(pin, stablecoin.symbol, numericAmount, "evm");
    await dispenseFromPayments(pin, stablecoin.symbol);
    console.log(`[EVM] ✅ Dispense successful for pin ${pin}`);
  } catch (error) {
    console.error(`[EVM] ❌ Dispense failed for pin ${pin}:`, error.message);
  }
};

const startEvmListener = () => {
  console.log("[EVM] 🚀 Starting EVM payment listener...");
  console.log(`[EVM] 📍 Payment address: ${PAYMENT_ADDRESS}`);

  const evmNetworks = Object.values(NETWORKS).filter(({ implementation }) => implementation === "EVM");
  console.log(`[EVM] 🌐 Found ${evmNetworks.length} EVM networks to monitor`);

  let totalContracts = 0;

  evmNetworks.forEach((network) => {
    console.log(`[EVM] 🔗 Connecting to ${network.name}...`);
    console.log(`[EVM] 📡 RPC endpoint: ${network.rpc}`);

    let provider;
    try {
      provider = new ethers.providers.JsonRpcProvider(network.rpc);
      console.log(`[EVM] ✅ Successfully connected to ${network.name}`);
    } catch (error) {
      console.error(`[EVM] ❌ Failed to connect to ${network.name}:`, error.message);
      return;
    }

    // Test provider connection
    provider.getNetwork()
      .then((networkInfo) => {
        console.log(`[EVM] 🎯 ${network.name} network confirmed - Chain ID: ${networkInfo.chainId}`);
      })
      .catch((error) => {
        console.error(`[EVM] ⚠️  ${network.name} network verification failed:`, error.message);
      });

    console.log(`[EVM] 💰 Setting up ${network.stablecoins.length} stablecoin watchers for ${network.name}:`);

    for (i in network.stablecoins) {
      const stablecoin = network.stablecoins[i];
      console.log(`[EVM] 🪙 Configuring ${stablecoin.symbol} watcher...`);
      console.log(`[EVM]    - Token address: ${stablecoin.address}`);
      console.log(`[EVM]    - Decimals: ${stablecoin.decimals}`);

      let contract;
      try {
        contract = new ethers.Contract(
          stablecoin.address,
          tokenAbi,
          provider
        );
        console.log(`[EVM] ✅ Contract created for ${stablecoin.symbol} on ${network.name}`);
      } catch (error) {
        console.error(`[EVM] ❌ Failed to create contract for ${stablecoin.symbol}:`, error.message);
        continue;
      }

      // Set up transfer event listener
      const filter = contract.filters.Transfer(null, PAYMENT_ADDRESS, null);
      console.log(`[EVM] 👂 Setting up transfer listener for ${stablecoin.symbol} on ${network.name}`);
      console.log(`[EVM]    - Watching transfers TO: ${PAYMENT_ADDRESS}`);

      contract.on(filter, (from, to, amount, event) => {
        console.log(`[EVM] 🎉 PAYMENT DETECTED!`);
        console.log(`[EVM] 📦 Network: ${network.name}`);
        console.log(`[EVM] 💰 Token: ${stablecoin.symbol}`);
        console.log(`[EVM] 📤 From: ${from}`);
        console.log(`[EVM] 📥 To: ${to}`);
        console.log(`[EVM] 💵 Raw amount: ${amount.toString()}`);
        console.log(`[EVM] 🧾 Transaction hash: ${event.transactionHash}`);
        console.log(`[EVM] 📊 Block number: ${event.blockNumber}`);

        handleStablecoinPayments(from, amount, network, stablecoin);
      });

      // Set up error handling
      contract.on("error", (error) => {
        console.error(`[EVM] ❌ Contract error for ${stablecoin.symbol} on ${network.name}:`, error.message);
      });

      totalContracts++;
      console.log(`[EVM] ✅ ${stablecoin.symbol} watcher active on ${network.name}`);
    }
  });

  console.log(`[EVM] 🎯 EVM listener setup complete!`);
  console.log(`[EVM] 📊 Total contracts monitoring: ${totalContracts}`);
  console.log(`[EVM] 🔍 Watching for transfers to: ${PAYMENT_ADDRESS}`);
  console.log(`[EVM] 💡 Payment format: Send amount ending in 1-6 for product selection`);
  console.log(`[EVM]    - Selection 1 → Pin 516 (coke)`);
  console.log(`[EVM]    - Selection 2 → Pin 517 (iced tea)`);
  console.log(`[EVM]    - Selection 3 → Pin 518 (poppi)`);
  console.log(`[EVM]    - Selection 4 → Pin 524 (bubbly)`);
  console.log(`[EVM]    - Selection 5 → Pin 525 (cooler)`);
  console.log(`[EVM]    - Selection 6 → Pin 528 (beer)`);
};

module.exports = {
  startEvmListener,
};
