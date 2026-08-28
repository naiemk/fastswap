import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib, keccak256, toUtf8Bytes } from "ethers";

describe("FastSwapReceiver (aggregator executor)", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer, recipient, sink] = await ethers.getSigners();

    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const implementation = await FastSwap.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const proxy = await Proxy.deploy(
      await implementation.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const fastSwap = await ethers.getContractAt("FastSwapReceiver", await proxy.getAddress());

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock Token", "MOCK", 18);

    const Sweeper = await ethers.getContractFactory("InvoiceSweeper");
    const sweeper = await Sweeper.deploy(await fastSwap.getAddress());

    const MockAdapter = await ethers.getContractFactory("MockAdapter");
    const mockAdapter = await MockAdapter.deploy(await fastSwap.getAddress(), await sink.getAddress());
    const adapterId = keccak256(toUtf8Bytes("mock"));
    await fastSwap.setAdapter(adapterId, await mockAdapter.getAddress());

    return { ethers, owner, payer, recipient, sink, fastSwap, token, sweeper, mockAdapter, adapterId };
  }

  it("records invoice payment through sweep", async function () {
    const { payer, recipient, fastSwap, sweeper } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = encodeIntentV2({
      minSourceAmount: sourceAmount,
      minAmountOut: ethersLib.parseEther("0.95"),
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);

    const record = await fastSwap.invoiceRecord(invoiceId);
    expect(record.status).to.equal(1n);
    expect(record.paidAmount).to.equal(sourceAmount);
  });

  it("executes via mock adapter after payment", async function () {
    const { payer, recipient, sink, fastSwap, sweeper, adapterId } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = encodeIntentV2({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);

    const routeData = ethersLib.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [ethersLib.ZeroAddress, "0x"]);
    await fastSwap.execute(invoiceId, adapterId, routeData, 1n);

    const record = await fastSwap.invoiceRecord(invoiceId);
    expect(record.status).to.equal(2n);
    expect(await sink.provider.getBalance(await sink.getAddress())).to.be.gt(0n);
  });

  it("refunds paid invoice to refund address", async function () {
    const { payer, recipient, fastSwap, sweeper } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = encodeIntentV2({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);

    const before = await recipient.provider.getBalance(recipient.address);
    await fastSwap.refund(invoiceId);
    const after = await recipient.provider.getBalance(recipient.address);
    expect(after - before).to.equal(sourceAmount);

    const record = await fastSwap.invoiceRecord(invoiceId);
    expect(record.status).to.equal(3n);
  });

  it("rejects execute when adapter is not registered", async function () {
    const { payer, recipient, fastSwap, sweeper } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = encodeIntentV2({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    await payer.sendTransaction({ to: await sweeper.getInvoiceAddress(invoiceId), value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);

    const badAdapter = keccak256(toUtf8Bytes("missing"));
    await expectRevert(
      fastSwap.execute(invoiceId, badAdapter, "0x", 1n),
      "InvalidAdapter"
    );
  });
});

async function expectRevert(promise: Promise<unknown>, reason: string) {
  try {
    await promise;
  } catch (error) {
    expect(String(error)).to.include(reason);
    return;
  }
  throw new Error("Expected transaction to revert");
}

function encodeIntentV2(overrides: {
  minSourceAmount?: bigint;
  minAmountOut?: bigint;
  recipient: string;
  refundTo: string;
}) {
  const recipientBytes = ethersLib.zeroPadValue(overrides.recipient, 20);
  const refundBytes = ethersLib.zeroPadValue(overrides.refundTo, 20);
  return ethersLib.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,bytes sourceToken,uint256 minSourceAmount,uint256 destChainId,bytes destToken,uint256 minAmountOut,bytes recipient,bytes refundTo,uint64 expiresAt,uint16 slippageBps)",
    ],
    [
      {
        version: 2,
        quoteId: ethersLib.id("quote"),
        sourceChainId: 1,
        sourceToken: "0x",
        minSourceAmount: overrides.minSourceAmount ?? 1n,
        destChainId: 2,
        destToken: "0x",
        minAmountOut: overrides.minAmountOut ?? 1n,
        recipient: recipientBytes,
        refundTo: refundBytes,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        slippageBps: 100,
      },
    ]
  );
}
