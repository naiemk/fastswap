import { expect } from "chai";
import { AbiCoder, ContractFactory, getCreate2Address, keccak256 } from "ethers";
import { hashDeploySalt, resolveDeploySalts } from "../config/salts.js";
import { CREATEX_ADDRESS, guardCreateXSalt, predictCreateXAddress, buildInitCode } from "../cli/createx.js";
import { readArtifact } from "../cli/artifacts.js";

describe("CreateX deployment", function () {
  const spec = { namespace: "fastswap", version: "1" };
  const salts = resolveDeploySalts(spec);

  it("derives stable bytes32 salts from namespace and version", function () {
    const a = hashDeploySalt("fastswap", "1", "invoiceSweeper");
    const b = hashDeploySalt("fastswap", "1", "invoiceSweeper");
    expect(a).to.equal(b);
    expect(a).to.match(/^0x[0-9a-f]{64}$/);
    expect(salts.fastSwapImplementation).to.not.equal(salts.fastSwapProxy);
  });

  it("predicts CreateX CREATE2 addresses using guarded salts", async function () {
    const sweeper = await readArtifact("InvoiceSweeper");
    const initCode = await buildInitCode(sweeper, ["0x00000000000000000000000000000000000000c0"]);

    const predicted = predictCreateXAddress(CREATEX_ADDRESS, salts.invoiceSweeper, initCode);
    const guardedSalt = guardCreateXSalt(salts.invoiceSweeper);
    const expected = getCreate2Address(CREATEX_ADDRESS, guardedSalt, keccak256(initCode));
    expect(predicted).to.equal(expected);
    expect(guardedSalt).to.equal(
      keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32"], [salts.invoiceSweeper]))
    );
  });

  it("uses distinct salts for each stack contract", async function () {
    const [fastSwap, proxy, sweeper] = await Promise.all([
      readArtifact("contracts/FastSwapReceiver.sol/FastSwapReceiver.json"),
      readArtifact("ReceiverProxy"),
      readArtifact("InvoiceSweeper"),
    ]);

    const owner = "0x000000000000000000000000000000000000dEaD";
    const fastSwapFactory = new ContractFactory(fastSwap.abi, fastSwap.bytecode);
    const initData = fastSwapFactory.interface.encodeFunctionData("initialize", [owner]);

    const fastSwapImplInit = await buildInitCode(fastSwap);
    const fastSwapImpl = predictCreateXAddress(CREATEX_ADDRESS, salts.fastSwapImplementation, fastSwapImplInit);

    const proxyInit = await buildInitCode(proxy, [fastSwapImpl, initData]);
    const fastSwapProxy = predictCreateXAddress(CREATEX_ADDRESS, salts.fastSwapProxy, proxyInit);

    const sweeperInit = await buildInitCode(sweeper, [fastSwapProxy]);
    const sweeperAddress = predictCreateXAddress(CREATEX_ADDRESS, salts.invoiceSweeper, sweeperInit);

    const addresses = [fastSwapImpl, fastSwapProxy, sweeperAddress];
    expect(new Set(addresses).size).to.equal(addresses.length);
  });
});
