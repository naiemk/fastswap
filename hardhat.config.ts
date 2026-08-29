import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha],
  test: {
    mocha: {
      timeout: 40_000,
      require: ["./test/helpers/ci-watchdog.cjs"],
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.24",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 1_000_000,
          },
          viaIR: true,
        },
      },
    },
  },
});
