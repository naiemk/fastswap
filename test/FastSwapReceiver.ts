import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib, keccak256, toUtf8Bytes } from "ethers";
import { mockAdapterId, signTestExecutePlan } from "./helpers/execute-plan.js";
import { destFieldsFromIntentData } from "./helpers/intent.js";

describe("FastSwapReceiver (aggregator executor)", function () {
  let connection: Awaited<ReturnType<typeof network.create>>;

  afterEach(async function () {
    if (connection) {
      await connection.close();
    }
  });

  async function deployFixture() {
    connection = await network.create();
    const { ethers } = connection as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer, recipient, sink] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const implementation = await FastSwap.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const proxy = await Proxy.deploy(
      await implementation.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize(address,uint16)", [owner.address, 75])
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
    await fastSwap.setTreasury(owner.address);
    const relayerRole = await fastSwap.RELAYER_ROLE();
    await fastSwap.grantRole(relayerRole, owner.address);

    const makeIntent = (overrides: Parameters<typeof encodeIntentV2>[0]) =>
      encodeIntentV2({ ...overrides, sourceChainId: chainId });

    return { ethers, owner, payer, recipient, sink, fastSwap, token, sweeper, mockAdapter, adapterId, chainId, makeIntent };
  }

  it("records invoice payment through sweep", async function () {
    const { payer, recipient, fastSwap, sweeper, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
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
    const { owner, payer, recipient, sink, fastSwap, sweeper, adapterId, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
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
    const dest = destFieldsFromIntentData(data);
    const signature = await signTestExecutePlan({
      signer: owner,
      fastSwap,
      invoiceId,
      adapterId,
      routeData,
      minAmountOut: minOut,
    });
    await executeWithDest(fastSwap, invoiceId, adapterId, routeData, data, signature);

    const record = await fastSwap.invoiceRecord(invoiceId);
    expect(record.status).to.equal(2n);
    expect(await sink.provider.getBalance(await sink.getAddress())).to.be.gt(0n);
  });

  it("refunds paid invoice to refund address", async function () {
    const { payer, recipient, fastSwap, sweeper, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
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
    const { payer, recipient, fastSwap, sweeper, token, makeIntent } = await deployFixture();
    const tokenAddress = await token.getAddress();
    const victimData = makeIntent({
      minSourceAmount: ethersLib.parseUnits("100", 18),
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
      sourceToken: tokenAddress,
    });
    const attackerData = makeIntent({
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

  it("rejects owner executeInvoice without a recorded payment", async function () {
    const { owner, recipient, fastSwap, makeIntent } = await deployFixture();
    const data = makeIntent({
      minSourceAmount: 1n,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    await expectRevert(
      fastSwap.connect(owner).executeInvoice(invoiceId, ethersLib.ZeroAddress, 1n, data),
      "InvalidPayment"
    );
  });

  it("allows permissionless refund after expiry", async function () {
    const { ethers, payer, recipient, fastSwap, sweeper, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const data = makeIntent({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
      expiresAt,
    });
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);
    await ethers.provider.send("evm_increaseTime", [121]);
    await ethers.provider.send("evm_mine", []);

    const before = await recipient.provider.getBalance(recipient.address);
    await fastSwap.connect(recipient).refund(invoiceId);
    const after = await recipient.provider.getBalance(recipient.address);
    expect(after - before).to.be.closeTo(sourceAmount, ethersLib.parseEther("0.001"));

    const record = await fastSwap.invoiceRecord(invoiceId);
    expect(record.status).to.equal(3n);
  });

  it("rejects non-relayer refund before expiry", async function () {
    const { payer, recipient, fastSwap, sweeper, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    await payer.sendTransaction({ to: await sweeper.getInvoiceAddress(invoiceId), value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);
    await expectRevert(fastSwap.connect(recipient).refund(invoiceId), "InvalidState");
  });

  it("refunds while paused", async function () {
    const { owner, payer, recipient, fastSwap, sweeper, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    await payer.sendTransaction({ to: await sweeper.getInvoiceAddress(invoiceId), value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);
    await fastSwap.pause();
    await fastSwap.refund(invoiceId);
    const record = await fastSwap.invoiceRecord(invoiceId);
    expect(record.status).to.equal(3n);
  });

  it("rejects execute after expiry grace window", async function () {
    const { ethers, owner, payer, recipient, fastSwap, sweeper, adapterId, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const data = makeIntent({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
      expiresAt,
    });
    const invoiceId = ethersLib.keccak256(data);
    await payer.sendTransaction({ to: await sweeper.getInvoiceAddress(invoiceId), value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);
    await ethers.provider.send("evm_increaseTime", [120 + 3601]);
    await ethers.provider.send("evm_mine", []);
    const routeData = ethersLib.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [ethersLib.ZeroAddress, "0x"]);
    const signature = await signTestExecutePlan({
      signer: owner,
      fastSwap,
      invoiceId,
      adapterId,
      routeData,
      minAmountOut: 1n,
    });
    await expectRevert(executeWithDest(fastSwap, invoiceId, adapterId, routeData, data, signature), "Expired");
  });

  it("blocks rescue of reserved invoice funds", async function () {
    const { owner, payer, recipient, fastSwap, sweeper, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
      minSourceAmount: sourceAmount,
      minAmountOut: 1n,
      recipient: recipient.address,
      refundTo: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    await payer.sendTransaction({ to: await sweeper.getInvoiceAddress(invoiceId), value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);
    await expectRevert(
      fastSwap.connect(owner).rescue(ethersLib.ZeroAddress, owner.address, sourceAmount),
      "InvalidPayment"
    );
  });

  it("allows rescue of unreserved donations", async function () {
    const { owner, payer, fastSwap, makeIntent } = await deployFixture();
    await payer.sendTransaction({ to: await fastSwap.getAddress(), value: ethersLib.parseEther("0.5") });
    const before = await owner.provider.getBalance(owner.address);
    await fastSwap.connect(owner).rescue(ethersLib.ZeroAddress, owner.address, ethersLib.parseEther("0.5"));
    const after = await owner.provider.getBalance(owner.address);
    expect(after).to.be.gt(before);
  });

  it("rejects execute when adapter is not registered", async function () {
    const { owner, payer, recipient, fastSwap, sweeper, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
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
      executeWithDest(fastSwap, invoiceId, badAdapter, routeData, data, signature),
      "InvalidAdapter"
    );
  });

  it("rejects execute with tampered minAmountOut in unsigned plan", async function () {
    const { owner, payer, recipient, fastSwap, sweeper, adapterId, makeIntent } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const data = makeIntent({
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
    await expectRevert(executeWithDest(fastSwap, invoiceId, adapterId, routeData, data, signature), "InvalidSignature");
  });
});

async function executeWithDest(
  fastSwap: { execute: (...args: unknown[]) => Promise<unknown> },
  invoiceId: string,
  adapterId: string,
  routeData: string,
  data: string,
  signature: string
) {
  const dest = destFieldsFromIntentData(data);
  return fastSwap.execute(
    invoiceId,
    adapterId,
    routeData,
    dest.destChainId,
    dest.destToken,
    dest.recipient,
    signature
  );
}

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
  expiresAt?: number;
  sourceChainId?: bigint;
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
        sourceChainId: overrides.sourceChainId ?? 1n,
        sourceToken: sourceTokenBytes,
        minSourceAmount: overrides.minSourceAmount ?? 1n,
        destChainId: 2,
        destToken: "0x",
        minAmountOut: overrides.minAmountOut ?? 1n,
        recipient: recipientBytes,
        refundTo: refundBytes,
        expiresAt: overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
        slippageBps: 100,
      },
    ]
  );
}
