import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib, keccak256, toUtf8Bytes } from "ethers";
import { mockAdapterId, signTestExecutePlan } from "./helpers/execute-plan.js";

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
    const mockAdapter = await MockAdapter.deploy(await fastSwap.getAddress(), owner.address, await sink.getAddress());
    const adapterId = mockAdapterId("mock");
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
    const { owner, payer, recipient, sink, fastSwap, sweeper, adapterId } = await deployFixture();
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
    const minOut = 1n;
    const signature = await signTestExecutePlan({
      signer: owner,
      fastSwap,
      invoiceId,
      adapterId,
      routeData,
      minAmountOut: minOut,
    });
    await fastSwap.execute(invoiceId, adapterId, routeData, signature);

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

  it("rejects idle ERC20 balance claim without forwarder pull", async function () {
    const { payer, recipient, fastSwap, sweeper, token } = await deployFixture();
    const tokenAddress = await token.getAddress();
    const victimData = encodeIntentV2({
      minSourceAmount: ethersLib.parseUnits("100", 18),
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
      sourceToken: tokenAddress,
    });
    const attackerData = encodeIntentV2({
      minSourceAmount: ethersLib.parseUnits("100", 18),
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
      quoteSalt: "attacker",
      sourceToken: tokenAddress,
    });
    const victimId = ethersLib.keccak256(victimData);
    const attackerId = ethersLib.keccak256(attackerData);
    const victimAddress = await sweeper.getInvoiceAddress(victimId);

    await token.mint(victimAddress, ethersLib.parseUnits("100", 18));
    await sweeper.sweepToken(victimId, tokenAddress, victimData);

    await expectRevert(
      fastSwap.receiveTokenInvoice(tokenAddress, attackerId, ethersLib.parseUnits("100", 18), attackerData),
      "ERC20InsufficientAllowance"
    );

    const attackerRecord = await fastSwap.invoiceRecord(attackerId);
    expect(attackerRecord.status).to.equal(0n);
  });

  it("rejects execute when adapter is not registered", async function () {
    const { owner, payer, recipient, fastSwap, sweeper } = await deployFixture();
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
    const routeData = "0x";
    const signature = await signTestExecutePlan({
      signer: owner,
      fastSwap,
      invoiceId,
      adapterId: badAdapter,
      routeData,
      minAmountOut: 1n,
    });
    await expectRevert(
      fastSwap.execute(invoiceId, badAdapter, routeData, signature),
      "InvalidAdapter"
    );
  });

  it("rejects execute with tampered minAmountOut in unsigned plan", async function () {
    const { owner, payer, recipient, fastSwap, sweeper, adapterId } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = encodeIntentV2({
      minSourceAmount: sourceAmount,
      minAmountOut: 100n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    await payer.sendTransaction({ to: await sweeper.getInvoiceAddress(invoiceId), value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);
    const routeData = ethersLib.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [ethersLib.ZeroAddress, "0x"]);
    const signature = await signTestExecutePlan({
      signer: owner,
      fastSwap,
      invoiceId,
      adapterId,
      routeData,
      minAmountOut: 1n,
    });
    await expectRevert(fastSwap.execute(invoiceId, adapterId, routeData, signature), "InvalidSignature");
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
  quoteSalt?: string;
  sourceToken?: string;
}) {
  const recipientBytes = ethersLib.zeroPadValue(overrides.recipient, 20);
  const refundBytes = ethersLib.zeroPadValue(overrides.refundTo, 20);
  const sourceTokenBytes =
    overrides.sourceToken && overrides.sourceToken !== ethersLib.ZeroAddress
      ? ethersLib.zeroPadValue(overrides.sourceToken, 20)
      : "0x";
  return ethersLib.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,bytes sourceToken,uint256 minSourceAmount,uint256 destChainId,bytes destToken,uint256 minAmountOut,bytes recipient,bytes refundTo,uint64 expiresAt,uint16 slippageBps)",
    ],
    [
      {
        version: 2,
        quoteId: ethersLib.id(overrides.quoteSalt ?? "quote"),
        sourceChainId: 1,
        sourceToken: sourceTokenBytes,
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
