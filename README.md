# Bepsi-pi

Code that lives in the bepsi vending machine that supports multiple payment methods:

- Listens to MATIC/DAI/USDC/USDT payments to `PAYMENT_ADDRESS`, on payment dispenses bepsi
- Listens to Spark Network (Bitcoin L2) payments via unique addresses per vending pin
- Listens to LNbits websockets for Lightning payments, on payment dispenses bepsi
- Listens to BTCPay websockets for Ark payments, on payment dispenses bepsi
- Listens to discord emoji reaction, on reaction dispenses bepsi

This guide was written for Debian 12.

## Prerequisites:

`sudo apt install git make build-essential`

Requires [Node.js](https://nodejs.org/en/download)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 20
```

Requires [Yarn](https://classic.yarnpkg.com/lang/en/docs/install/#debian-stable)

```bash
npm install --global yarn
```

## Install:

```bash
git clone https://github.com/GitYVR/bepsi-pi.git
cd bepsi-pi
yarn install
```

Copy the example environment and fill out the parameters:

```bash
cp .env.example .env
nano .env
```

To test run:

```bash
yarn start
```

## Run

To persist bepsi-pi and make it run on startup:

```bash
cd ~/bepsi-pi
npm install -g pm2
pm2 start index.js --name bepsi-pi --exp-backoff-restart-delay=100
pm2 startup
```

pm2 will then issue you a command that will generate and install a systemd file for your system. Run this command and restart your machine to test this.

Useful commands:

```bash
pm2 list
pm2 monit
```

To see logs:

```bash
pm2 logs bepsi-pi
```

## Payment Systems

This vending machine supports multiple payment methods:

### Spark Network (Bitcoin L2)
Configure `SPARK_PIN_*` wallet addresses and mnemonics in `.env` for Spark payments

### EVM/Polygon
Configure `PAYMENT_ADDRESS` in `.env` to accept MATIC/DAI/USDC/USDT

### Ark (via BTCPay)
Configure `ARKADE_WS_URL` in `.env` for Ark payments via BTCPay websockets

### Lightning Network
Configure `LIGHTNING_LNBIT_URL` in `.env` for LNbits integration. LNbits only tells bepsi
which pin to dispense, not the price, so set `LIGHTNING_PIN_<pin>_AMOUNT` (sats) to match each
drink's price in LNbits; sales on a pin without one are recorded with no amount.

### Solana
Configure `SOLANA_TREASURY_ADDRESS` in `.env` for Solana payments

## Sales ledger

Every sale (all payment methods, plus Discord dispenses) is recorded in the purchases ledger,
a small SQLite service shared with the spiro machine:

- `LEDGER_URL`: the ledger's purchases endpoint, e.g. `http://<ledger-host>:8888/purchases`
- `LEDGER_TOKEN`: the ledger's access token
- `LEDGER_MACHINE` (optional, default `bepsi`): the machine name rows are tagged with

A sale the ledger doesn't accept is kept in `ledger-queue.json` and retried every minute, so it
is recorded late rather than lost. `/health` has a `ledger` section showing whether the ledger
is reachable and how many sales are waiting to be sent.
