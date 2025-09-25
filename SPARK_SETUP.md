# Spark Network Payment Integration

This guide explains how to set up Spark Network payments (Bitcoin L2) and token support for the bepsi-pi vending machine.

## Features

- **Multi-pin wallet architecture**: Each vending machine slot has its own unique Spark address
- **Dual payment support**: Accepts both Bitcoin/satoshis and Spark tokens
- **Automatic consolidation**: Funds swept to treasury wallet after dispensing
- **Token support**: Accepts FreshToken768333 and other configurable tokens
- **Resilient operation**: Works independently of other payment systems

## Quick Setup

### 1. Generate Spark Wallets

First, generate unique wallets for each vending machine pin:

```bash
node generate-pin-wallets.js
```

This will output 6 pin wallets + 1 treasury wallet with addresses and mnemonics.

### 2. Configure Environment

Add the generated values to your `.env` file:

```bash
# Spark payment configuration
SPARK_PAYMENT_AMOUNT=1000  # Minimum satoshis required for payment

# Pin wallets (copy ALL from generate-pin-wallets.js output)
SPARK_PIN_4_ADDRESS=sp1pgssy9ym6tyx6938p2yk0dadkkkvpwnyagk4t8suxs899w8q5szjm3hwg47knu
SPARK_PIN_4_MNEMONIC=section sunny trick gas warfare crime trash recall tuition relief illegal soccer

SPARK_PIN_5_ADDRESS=sp1pgssy38nwhhrjr7yt2fkcerhdw9qthzn343k7nnqkawv92udwdycdq222ujkv3
SPARK_PIN_5_MNEMONIC=enlist lunch much comfort trust dice gas wife cement bus trouble desert

SPARK_PIN_6_ADDRESS=sp1pgssxlvhd0vdjvy8ddrx3yn0wt743l729jt62zmwfz5xy55gwezkqnslmg28kc
SPARK_PIN_6_MNEMONIC=gown wild garlic usual airport tribe strategy trust pupil predict peace token

SPARK_PIN_12_ADDRESS=sp1pgss8jg88qc5nqx07vm66th466t3nv7vjd53lgvdhk04naataemlu36jsv3kmm
SPARK_PIN_12_MNEMONIC=any trim end reason gown mail water enemy drum siren roof lecture

SPARK_PIN_13_ADDRESS=sp1pgssywfwq8fve8qtknwa578avngrf46vmqft2d24yle5wlzsnv4h69akyh88sn
SPARK_PIN_13_MNEMONIC=impulse snow charge debris expect black enforce improve dirt voice neutral scissors

SPARK_PIN_16_ADDRESS=sp1pgssyd7nuauynquyt7ya8ju2y0ttwr5gkm5xp2263ejhax59kcgq0yrxehd9tj
SPARK_PIN_16_MNEMONIC=convince accident settle author clerk avoid age banana sell slush around artist

# Treasury wallet for automatic fund consolidation (optional but recommended)
SPARK_TREASURY_ADDRESS=sp1pgssxhfa0shaxavasuqeajv75z7j4c3hny56x5x995jy4d0kwz09nt3ewdc9fh
SPARK_TREASURY_MNEMONIC=dad spell crumble coral year firm chief ripple industry soldier faith drastic
```

### 3. Install Dependencies

The Spark SDK is already included in package.json:

```bash
yarn install  # or npm install
```

### 4. Start the Application

```bash
yarn start  # or npm start
```

The system will display the payment addresses:

```
[Spark] 🎯 Vending machine ready! Each pin has unique address:
[Spark] Pin 4: sp1pgssy9ym6tyx6938p2yk0dadkkkvpwnyagk4t8suxs899w8q5szjm3hwg47knu
[Spark] Pin 5: sp1pgssy38nwhhrjr7yt2fkcerhdw9qthzn343k7nnqkawv92udwdycdq222ujkv3
[Spark] Pin 6: sp1pgssxlvhd0vdjvy8ddrx3yn0wt743l729jt62zmwfz5xy55gwezkqnslmg28kc
[Spark] Pin 12: sp1pgss8jg88qc5nqx07vm66th466t3nv7vjd53lgvdhk04naataemlu36jsv3kmm
[Spark] Pin 13: sp1pgssywfwq8fve8qtknwa578avngrf46vmqft2d24yle5wlzsnv4h69akyh88sn
[Spark] Pin 16: sp1pgssyd7nuauynquyt7ya8ju2y0ttwr5gkm5xp2263ejhax59kcgq0yrxehd9tj
```

## Pin to Product Mapping

- **Pin 4**: Lime (Green)
- **Pin 5**: Strawberry (Red)
- **Pin 6**: Grapefruit (Pink)
- **Pin 12**: Cherry (Dark Red)
- **Pin 13**: Purple (Grape)
- **Pin 16**: Orange

## Payment Types

### Bitcoin/Satoshi Payments
- **Minimum amount**: 1000 satoshis (configurable via `SPARK_PAYMENT_AMOUNT`)
- **Send to**: Any pin address
- **Detection time**: Within 5 seconds

### Token Payments
- **Bepsi Token**: Minimum 1.0 token per payment
  - Token ID: `btkn1xecvlqngfwwvw2z38s67rn23r76m2vpkmwavfr9cr6ytzgqufu0ql0a4qk`
- **Send to**: Same pin addresses as satoshi payments
- **Detection time**: Within 5 seconds

## Monitoring & Logs

View payment activity:

```bash
# If using pm2
pm2 logs bepsi-pi

# If using Docker
docker logs bepsi-consolidation-test

# If running directly
# Logs appear in console
```

Payment detection logs show:
- `[Spark] Payment received for pin X!` - Satoshi payment detected
- `[Spark] ✅ SATOSHI PAYMENT CONFIRMED` - Payment accepted
- `[Spark] 🥤 Triggering dispensing` - Vending machine activated
- `[Spark] 💰 Starting consolidation` - Funds being swept to treasury

## Testing

### Docker Testing Environment

```bash
# Build and run test container
docker build -t bepsi-test .
docker run -d --name bepsi-consolidation-test --env-file .env.test -p 3002:3000 bepsi-test

# View logs
docker logs -f bepsi-consolidation-test
```

### Manual Fund Sweeping

To manually consolidate all funds to a specific address:

```bash
node sweep-all-funds.js
```

Edit the target address in the script before running.

## Troubleshooting

### "Missing environment variables"
- Ensure all `SPARK_PIN_X_ADDRESS` and `SPARK_PIN_X_MNEMONIC` are set for pins 4, 5, 6, 12, 13, 16
- Run `node generate-pin-wallets.js` to generate fresh wallets

### Payment not detected
- Check wallet has confirmed balance: payment must be confirmed on Spark Network
- Verify correct pin address was used
- Check logs for balance updates every 5 seconds

### Token payment not working
- Bepsi Token is now configured with ID: `btkn1xecvlqngfwwvw2z38s67rn23r76m2vpkmwavfr9cr6ytzgqufu0ql0a4qk`
- Minimum payment is 1.0 token
- Token balance changes are tracked separately from satoshi balance
- Check logs for "TOKEN PAYMENT DETECTED" messages

### Consolidation errors
- Treasury wallet is optional - payments work without it
- Token consolidation API may show warnings - this doesn't affect payment processing
- Manual sweep available via `sweep-all-funds.js`

## Security Notes

- **Keep mnemonics secret**: Never commit `.env` file to git
- **Backup wallets**: Save generated mnemonics securely
- **Test first**: Use testnet or small amounts initially
- **Monitor balances**: Treasury consolidation is automatic but verify periodically

## Architecture

```
Customer → Pays to Pin Address → Payment Detection (5 sec) → Dispense Product → Auto-Consolidate to Treasury (10 sec)
```

Each pin maintains:
- Unique Spark address
- Independent wallet
- Satoshi balance tracking
- Token balance tracking (per token type)

## Adding More Token Support

The Bepsi Token is already configured. To accept additional Spark tokens, edit `src/listeners/sparkL.js`:

```javascript
const SUPPORTED_TOKENS = {
  'BepsiToken': {
    identifier: 'btkn1xecvlqngfwwvw2z38s67rn23r76m2vpkmwavfr9cr6ytzgqufu0ql0a4qk',
    name: 'Bepsi Token',
    minAmount: 1.0
  },
  // Add more tokens here:
  'YourToken': {
    identifier: 'btkn1...your_token_id...',
    name: 'Your Token Name',
    minAmount: 1.0  // Minimum required for payment
  }
};
```

## Dependencies

- `@buildonspark/issuer-sdk@0.0.99` - Spark wallet operations
- Node.js 18+
- npm or yarn

## Support

For issues specific to Spark payments:
- Check logs for error messages
- Verify environment variables are set
- Ensure Spark Network connectivity
- Review wallet balances manually if needed

The system is designed to be resilient - if Spark configuration is missing or incorrect, other payment systems (Lightning, EVM, Solana) continue working normally.