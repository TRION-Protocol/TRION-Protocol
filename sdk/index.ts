/**
 * TRION Protocol SDK
 *
 * Provides bit-packing utilities for constructing and decoding the 256-bit
 * signal format used by TRIONOracleV3.
 *
 * Signal layout (uint256):
 *   Bits   0–7   : status     (1=SAFE, 2=WARN, 3=SILENCE)
 *   Bits   8–39  : coherence  C(t)   scaled ×1e6
 *   Bits  40–71  : threshold  Θ(t)   scaled ×1e6
 *   Bits  72–135 : blockNum
 *   Bits 136–199 : timestamp  (unix seconds)
 */
export class TrionSDK {
    /**
     * Pack signal fields into a single 256-bit BigInt for on-chain submission.
     *
     * @param status    Signal type: 1=SAFE, 2=WARN, 3=SILENCE
     * @param coherence C(t) score scaled by 1e6 (e.g. 0.612 → 612000)
     * @param threshold Θ(t) baseline scaled by 1e6
     * @param blockNum  Block number the signal was generated for
     * @param timestamp Unix timestamp (seconds)
     */
    static packSignal(
        status: number,
        coherence: number,
        threshold: number,
        blockNum: number,
        timestamp: number,
    ): bigint {
        let packed = BigInt(status)    & BigInt(0xFF);
        packed |= (BigInt(coherence)  & BigInt(0xFFFFFFFF))           << BigInt(8);
        packed |= (BigInt(threshold)  & BigInt(0xFFFFFFFF))           << BigInt(40);
        packed |= (BigInt(blockNum)   & BigInt(0xFFFFFFFFFFFFFFFF))   << BigInt(72);
        packed |= (BigInt(timestamp)  & BigInt(0xFFFFFFFFFFFFFFFF))   << BigInt(136);
        return packed;
    }

    /**
     * Decode a packed 256-bit signal back into its component fields.
     */
    static unpackSignal(packed: bigint): {
        status: number;
        coherence: number;
        threshold: number;
        blockNum: number;
        timestamp: number;
    } {
        return {
            status:    Number(packed                        & BigInt(0xFF)),
            coherence: Number((packed >> BigInt(8))         & BigInt(0xFFFFFFFF)),
            threshold: Number((packed >> BigInt(40))        & BigInt(0xFFFFFFFF)),
            blockNum:  Number((packed >> BigInt(72))        & BigInt(0xFFFFFFFFFFFFFFFF)),
            timestamp: Number((packed >> BigInt(136))       & BigInt(0xFFFFFFFFFFFFFFFF)),
        };
    }
}
