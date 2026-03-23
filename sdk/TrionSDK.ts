export class TrionSDK {
    /**
     * Packs thermodynamic data into a single 256-bit BigInt for gas-efficient on-chain storage.
     */
    static packSignal(
        status: number,     // 1 = SAFE, 2 = WARN, 3 = SILENCE
        coherence: number,  // Scaled by 1e6
        threshold: number,  // Scaled by 1e6
        blockNum: number,
        timestamp: number
    ): bigint {
        let packed = BigInt(status) & BigInt(0xFF);
        packed |= (BigInt(coherence) & BigInt(0xFFFFFFFF)) << BigInt(8);
        packed |= (BigInt(threshold) & BigInt(0xFFFFFFFF)) << BigInt(40);
        packed |= (BigInt(blockNum) & BigInt(0xFFFFFFFFFFFFFFFF)) << BigInt(72);
        packed |= (BigInt(timestamp) & BigInt(0xFFFFFFFFFFFFFFFF)) << BigInt(136);
        
        return packed;
    }

    static unpackSignal(packed: bigint) {
        return {
            status: Number(packed & BigInt(0xFF)),
            coherence: Number((packed >> BigInt(8)) & BigInt(0xFFFFFFFF)),
            threshold: Number((packed >> BigInt(40)) & BigInt(0xFFFFFFFF)),
            blockNum: Number((packed >> BigInt(72)) & BigInt(0xFFFFFFFFFFFFFFFF)),
            timestamp: Number((packed >> BigInt(136)) & BigInt(0xFFFFFFFFFFFFFFFF))
        };
    }
}
