const { IssuerSparkWallet } = require("@buildonspark/issuer-sdk");

async function checkBalance() {
  try {
    const { wallet } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: "hurdle base poverty palace virus mesh hurdle pet list light saddle ski",
      options: { network: "MAINNET" }
    });

    const address = await wallet.getSparkAddress();
    const balance = await wallet.getBalance();
    
    console.log(`Address: ${address}`);
    console.log(`Balance: ${balance.balance} sats`);
    
    if (balance.tokenBalances && balance.tokenBalances.size > 0) {
      console.log(`Tokens:`);
      for (const [tokenId, tokenData] of balance.tokenBalances) {
        const rawAmount = BigInt(tokenData.balance);
        const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
        console.log(`  ${tokenId.slice(0,20)}...: ${tokenAmount}`);
      }
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

checkBalance();
