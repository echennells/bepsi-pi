const { Gpio } = require("onoff");
const { sleep } = require("./common");
const { recordSale } = require("./ledger");

let isDispensing = false;

// Build pin to item mapping from environment variables
const VENDING_PINS = [516, 517, 518, 524, 525, 528];
const pinToItem = {};
VENDING_PINS.forEach(pin => {
  const envName = process.env[`PIN_${pin}_NAME`];
  if (envName) {
    pinToItem[pin] = envName;
  }
});

const getDispenseItemGivenPin = (pinNo) =>
  pinToItem[pinNo] || `unmarked-${pinNo}`;

const dispense = async (pinNo) => {
  // Can only dispense one at a time to avoid overloading
  if (isDispensing) return;
  isDispensing = true;

  try {
    const pin = new Gpio(pinNo, "out");
    pin.writeSync(0);
    await sleep(500);
    pin.writeSync(1);
    console.log(`Dispensed pin ${pinNo} successfully`);
  } catch (error) {
    console.log(error.message);
  }

  isDispensing = false;
};

const dispenseFromDiscord = async (pinNo) => {
  // Dispense first; the ledger write happens in the background so it can't delay it.
  dispense(pinNo);
  logPayment(pinNo, "discord", null, "discord");
};

const dispenseFromPayments = async (pinNo, currency) => {
  // Only handle physical dispensing - logging is done by logPayment()
  console.log("Dispensing pin " + pinNo);
  dispense(pinNo);
};

// Records a sale in the purchases ledger. Never throws, and listeners don't wait for it.
const logPayment = (pinNo, currency, amount = null, paymentMethod = "unknown") =>
  recordSale({
    item: getDispenseItemGivenPin(pinNo),
    currency,
    amount,
    paymentMethod,
  }).catch((error) => console.error("[Ledger] Unexpected error recording sale:", error));

// Right to left, pins
// [4, 5, 6, 12, 13, 16, 9]

module.exports = {
  dispense,
  dispenseFromDiscord,
  dispenseFromPayments,
  logPayment,
};
