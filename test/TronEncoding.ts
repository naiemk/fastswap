import { expect } from "chai";
import { AbiCoder, hexlify, zeroPadValue } from "ethers";
import { encodeFastSwapIntent, getFastSwapInvoiceId, quoteToIntent, INTENT_VERSION_V2 } from "../shared/encoding.js";
import {
  evmHexToTronBase58,
  isTronBase58Address,
  tronAddressToEvmHex,
} from "../shared/tron-address.js";
import type { FastSwapChainConfig, FastSwapQuote } from "../shared/types.js";

const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TRON_RECIPIENT = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const EVM_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const EVM_RECIPIENT = "0x52908400098527886E0F7030069857D2E4169EE7";

const chains: FastSwapChainConfig[] = [
  {
    id: "11155111",
    type: "evm",
    name: "Sepolia",
    nativeSymbol: "ETH",
    sweeperAddress: EVM_TOKEN,
    fastSwapAddress: EVM_TOKEN,
    explorerUrl: "",
    tokens: [],
  },
  {
    id: "3448148188",
    type: "tron",
    name: "TRON Nile",
    nativeSymbol: "TRX",
    sweeperAddress: TRON_USDT,
    fastSwapAddress: TRON_USDT,
    explorerUrl: "",
    tokens: [],
  },
];

const INTENT_V2_TUPLE = [
  "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,bytes sourceToken,uint256 minSourceAmount,uint256 destChainId,bytes destToken,uint256 minAmountOut,bytes recipient,bytes refundTo,uint64 expiresAt,uint16 slippageBps)",
];

describe("TRON address helpers", function () {
  it("detects base58 TRON addresses", function () {
    expect(isTronBase58Address(TRON_USDT)).to.equal(true);
    expect(isTronBase58Address(EVM_TOKEN)).to.equal(false);
    expect(isTronBase58Address("native")).to.equal(false);
  });

  it("round-trips base58 <-> 20-byte hex body", function () {
    const hex = tronAddressToEvmHex(TRON_USDT);
    expect(hex).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(evmHexToTronBase58(hex)).to.equal(TRON_USDT);
  });
});

describe("FastSwap intent encoding (v2, chain-type aware)", function () {
  it("encodes TRON token slots as 20-byte bodies", function () {
    const quote = baseQuote({
      sourceChainId: "3448148188",
      sourceToken: TRON_USDT,
      targetChainId: "11155111",
      targetToken: EVM_TOKEN,
      recipient: EVM_RECIPIENT,
    });
    const intent = quoteToIntent(quote, chains);
    expect(intent.sourceToken.toLowerCase()).to.equal(hexlify(zeroPadValue(tronAddressToEvmHex(TRON_USDT), 20)).toLowerCase());
    expect(intent.destToken.toLowerCase()).to.equal(hexlify(zeroPadValue(EVM_TOKEN, 20)).toLowerCase());

    const data = encodeFastSwapIntent(intent);
    const [decoded] = AbiCoder.defaultAbiCoder().decode(INTENT_V2_TUPLE, data);
    expect(Number(decoded.version)).to.equal(Number(INTENT_VERSION_V2));
    expect(getFastSwapInvoiceId(data)).to.match(/^0x[0-9a-fA-F]{64}$/);
  });

  it("encodes a TRON target recipient as bytes", function () {
    const quote = baseQuote({
      sourceChainId: "11155111",
      sourceToken: "native",
      targetChainId: "3448148188",
      targetToken: TRON_USDT,
      recipient: TRON_RECIPIENT,
    });
    const intent = quoteToIntent(quote, chains);
    expect(evmHexToTronBase58(intent.recipient)).to.equal(TRON_RECIPIENT);
    expect(evmHexToTronBase58(intent.destToken)).to.equal(TRON_USDT);
  });

  it("maps native tokens to empty bytes on both chains", function () {
    const quote = baseQuote({
      sourceChainId: "11155111",
      sourceToken: "native",
      targetChainId: "3448148188",
      targetToken: "native",
      recipient: TRON_RECIPIENT,
    });
    const intent = quoteToIntent(quote, chains);
    expect(intent.sourceToken).to.equal("0x");
    expect(intent.destToken).to.equal("0x");
  });
});

function baseQuote(overrides: Partial<FastSwapQuote>): FastSwapQuote {
  const sourceChainId = overrides.sourceChainId ?? "11155111";
  const defaultRefund = sourceChainId === "3448148188" ? TRON_RECIPIENT : EVM_RECIPIENT;
  return {
    quoteId: "0x" + "11".repeat(32),
    expiresAt: Date.now() + 60_000,
    sourceChainId: "11155111",
    sourceToken: "native",
    sourceAmount: "1000000",
    targetChainId: "3448148188",
    targetToken: "native",
    targetAmount: "950000",
    recipient: TRON_RECIPIENT,
    refundAddress: defaultRefund,
    feeAmount: "0",
    slippageBps: 100,
    selectedProvider: "mock",
    sources: [],
    ...overrides,
  };
}
