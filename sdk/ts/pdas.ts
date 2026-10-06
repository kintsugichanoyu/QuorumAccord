import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
} from "@solana/kit";
import { QUORUM_ALLOCATION_PROGRAM_ADDRESS } from "./generated/index.js";

const programAddress = QUORUM_ALLOCATION_PROGRAM_ADDRESS;
const byte = (value: number) => {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new RangeError("feed IDs must be u8");
  return Uint8Array.of(value);
};
async function derive(seeds: (string | Uint8Array)[]): Promise<Address> {
  return (await getProgramDerivedAddress({ programAddress, seeds }))[0];
}
export const getRegistryAddress = () => derive(["registry"]);
export const getDataFeedAddress = (pool: number, metric: number) =>
  derive(["data_feed", byte(pool), byte(metric)]);
export async function getSampleConsensusAddress(
  pool: number,
  metric: number,
  window: bigint,
) {
  return derive([
    "tick_consensus",
    new Uint8Array(
      getAddressEncoder().encode(await getDataFeedAddress(pool, metric)),
    ),
    new Uint8Array(getU64Encoder().encode(window)),
  ]);
}
export const getAllocationConsensusAddress = (round: bigint) =>
  derive(["consensus", new Uint8Array(getU64Encoder().encode(round))]);
export const getAllocationStateAddress = () => derive(["allocation_state"]);
