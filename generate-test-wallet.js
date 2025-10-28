const { IssuerSparkWallet } = require("@buildonspark/issuer-sdk");

async function generateTestWallet() {
  try {
    const { wallet, mnemonic } = await IssuerSparkWallet.initialize({
      options: {
        network: "MAINNET",
      },
    });

    console.log("🧪 Test Wallet Generated\n");
    console.log(`Address: ${wallet.sparkAddress}`);
    console.log(`Mnemonic: ${mnemonic}`);
    console.log("\n📝 Add this to GitHub Secrets:");
    console.log(`TEST_WALLET_MNEMONIC=${mnemonic}`);
  } catch (error) {
    console.error("Failed to generate test wallet:", error.message);
  }
}

generateTestWallet();
