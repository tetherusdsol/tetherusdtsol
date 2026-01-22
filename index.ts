import { Metaplex, irysStorage, keypairIdentity, toMetaplexFile, token } from "@metaplex-foundation/js";
import { TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { Cluster, Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import bs58 from "bs58";
import * as dotenv from "dotenv";
import fs from "fs";

// Load environment variables
dotenv.config();

async function ensureWalletFunded(connection: Connection, walletPublicKey: PublicKey, network: Cluster): Promise<void> {
    const lamports = await connection.getBalance(walletPublicKey, "confirmed");
    if (lamports > 0) return;

    if (network !== "devnet") {
        throw new Error(
            `Wallet ${walletPublicKey.toBase58()} has no SOL (balance 0). ` +
            `On ${network} you must fund it manually before continuing.`
        );
    }

    console.log("🪂 Wallet has 0 SOL on devnet. Requesting 1 SOL airdrop...");
    const signature = await connection.requestAirdrop(walletPublicKey, 1_000_000_000);
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
        {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
    );

    const newBalance = await connection.getBalance(walletPublicKey, "confirmed");
    console.log(`✅ Airdrop confirmed. New balance: ${newBalance} lamports`);
}

function parsePrivateKeyToKeypair(privateKeyRaw: string): Keypair {
    const value = privateKeyRaw.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

    // Format 1: JSON array (Solana CLI) -> [12,34,...]
    if (value.startsWith("[")) {
        const secretKey = Uint8Array.from(JSON.parse(value));
        return Keypair.fromSecretKey(secretKey);
    }

    // Format 2: Base58 (Phantom / export string)
    const decoded = bs58.decode(value);
    if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
    if (decoded.length === 32) return Keypair.fromSeed(decoded);

    throw new Error(
        `Invalid PRIVATE_KEY: expected a JSON array or Base58 (32 or 64 bytes after decoding). Received length: ${decoded.length}`
    );
}

async function mintMoreTokens(params: {
    metaplex: Metaplex;
    mintAddress: PublicKey;
    decimals: number;
    symbol: string;
    amount: number;
    toOwner?: PublicKey;
}): Promise<void> {
    const { metaplex, mintAddress, decimals, symbol, amount, toOwner } = params;
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("MINT_AMOUNT must be a number greater than 0");
    }

    await metaplex.tokens().mint({
        mintAddress,
        toOwner,
        amount: token(amount, decimals, symbol),
    });
}

async function createFullProfessionalToken(): Promise<void> {
    // Environment variables
    const DECIMALS = process.env.DECIMALS ? Number(process.env.DECIMALS) : 6;
    const SYMBOL = process.env.SYMBOL ? process.env.SYMBOL : "USDT";
    const NAME = process.env.NAME ? process.env.NAME : "Tether USD (Solana)";
    const PRIVATE_KEY = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY : "";
    const SOLANA_NETWORK = process.env.SOLANA_NETWORK ? process.env.SOLANA_NETWORK : "devnet";
    const DESCRIPTION = process.env.DESCRIPTION
        ? process.env.DESCRIPTION
        : "Tether USD Solana is a stablecoin that is pegged to the US dollar.";
    const EXTERNAL_URL = process.env.EXTERNAL_URL ? process.env.EXTERNAL_URL : "https://solanafusdt.wixsite.com/tether-usd-solana";
    const TWITTER = process.env.TWITTER ? process.env.TWITTER : "https://x.com/tetherusdtsol";
    const TELEGRAM = process.env.TELEGRAM ? process.env.TELEGRAM : "https://t.me/tetherusdtsol";
    const WEBSITE = process.env.WEBSITE ? process.env.WEBSITE : "https://solanafusdt.wixsite.com/tether-usd-solana";
    const MINT_AMOUNT = process.env.MINT_AMOUNT ? Number(process.env.MINT_AMOUNT) : 0;
    const MINT_TO = process.env.MINT_TO ? process.env.MINT_TO : "";

    // Network
    const network = (SOLANA_NETWORK || "devnet") as Cluster;
    const connection = new Connection(clusterApiUrl(network), "confirmed");

    if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY is missing");

    const wallet = parsePrivateKeyToKeypair(PRIVATE_KEY);
    await ensureWalletFunded(connection, wallet.publicKey, network);

    const irysAddress = network === "mainnet-beta"
        ? "https://node1.irys.xyz"
        : "https://devnet.irys.xyz";

    const metaplex = Metaplex.make(connection)
        .use(keypairIdentity(wallet))
        .use(irysStorage({
            address: irysAddress,
            providerUrl: clusterApiUrl(network),
            timeout: 60000,
        }));

    console.log(`🔌 Connected to ${network} with wallet: ${wallet.publicKey.toBase58()}`);

    // 4. Load image
    const imageBuffer = fs.readFileSync("./logo.png");
    const file = toMetaplexFile(imageBuffer, "logo.png");

    console.log("🖼️ Uploading image to Arweave...");
    const imageUri = await metaplex.storage().upload(file);
    const imageUriIrys = network === "mainnet-beta" ? imageUri : imageUri.replace("arweave.net", "gateway.irys.xyz");
    console.log("✅ Image uploaded successfully:", imageUriIrys);

    // 5. Upload JSON metadata (extended/professional)
    const { uri } = await metaplex.nfts().uploadMetadata({
        name: NAME,
        symbol: SYMBOL,
        description: DESCRIPTION,
        image: imageUriIrys,
        external_url: EXTERNAL_URL,
        attributes: [
            { trait_type: "Utility", value: "Stablecoin" },
            { trait_type: "Tax", value: "0%" },
            { trait_type: "Chain", value: "Solana" },
            { trait_type: "Verified", value: "Standard" }
        ],
        properties: {
            files: [{ uri: imageUriIrys, type: "image/png" }],
            category: "image",
            links: {
                twitter: TWITTER,
                telegram: TELEGRAM,
                website: WEBSITE
            }
        }
    });

    const metadataUriIrys = network === "mainnet-beta" ? uri : uri.replace("arweave.net", "gateway.irys.xyz");
    console.log("🧾 Metadata JSON published at:", metadataUriIrys);

    // 6. Create token mint + on-chain metadata
    console.log("🪙 Creating token on-chain...");

    const { sft } = await metaplex.nfts().createSft({
        name: NAME,
        symbol: SYMBOL,
        uri: metadataUriIrys,
        decimals: DECIMALS,
        sellerFeeBasisPoints: 0,
        tokenStandard: TokenStandard.Fungible,
    });

    // 7. Optional initial mint to a destination wallet.
    // Env vars:
    // - MINT_AMOUNT: amount in UI units (e.g. "1000.5")
    // - MINT_TO: destination publicKey (optional; defaults to the script wallet)
    if (MINT_AMOUNT && MINT_AMOUNT > 0) {
        const toOwner = MINT_TO ? new PublicKey(MINT_TO) : wallet.publicKey;

        console.log(`🧬 Minting ${MINT_AMOUNT} ${SYMBOL} to ${toOwner.toBase58()}...`);
        await mintMoreTokens({
            metaplex,
            mintAddress: sft.address,
            decimals: DECIMALS,
            symbol: SYMBOL,
            amount: MINT_AMOUNT as number,
            toOwner,
        });
        console.log("✅ Mint completed.");
    }

    console.log(`
    --------------------------------------------------
    ✅ TOKEN CREATED SUCCESSFULLY
    --------------------------------------------------
    Mint address: ${sft.address.toString()}
    Network: ${network}
    Explorer: https://explorer.solana.com/address/${sft.address.toString()}?cluster=${network}
    --------------------------------------------------
    `);
}

createFullProfessionalToken().catch((err) => {
    console.error("💥 An error occurred during the process:", err);
});