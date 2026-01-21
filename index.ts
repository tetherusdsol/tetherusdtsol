import { Metaplex, irysStorage, keypairIdentity, toMetaplexFile, token } from "@metaplex-foundation/js";
import { TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { Cluster, Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as dotenv from "dotenv";
import fs from "fs";

// Cargamos las variables de entorno
dotenv.config();

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
        throw new Error("MINT_AMOUNT debe ser un número mayor a 0");
    }

    await metaplex.tokens().mint({
        mintAddress,
        toOwner,
        amount: token(amount, decimals, symbol),
    });
}

async function createFullProfessionalToken(): Promise<void> {
    // Variables de entorno
    const decimals = process.env.DECIMALS ? Number(process.env.DECIMALS) : 6;
    const symbol = process.env.SYMBOL ? process.env.SYMBOL : "USDT";
    const name = process.env.NAME ? process.env.NAME : "Tether USD (Solana)";
    const privateKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY : "";
    const solanaNetwork = process.env.SOLANA_NETWORK ? process.env.SOLANA_NETWORK : "devnet";
    const description = process.env.DESCRIPTION ? process.env.DESCRIPTION : "Tether USD Solana is a stablecoin that is pegged to the US dollar.";
    const externalUrl = process.env.EXTERNAL_URL ? process.env.EXTERNAL_URL : "https://solanafusdt.wixsite.com/tether-usd-solana";
    const twitter = process.env.TWITTER ? process.env.TWITTER : "https://x.com/tetherusdtsol";
    const telegram = process.env.TELEGRAM ? process.env.TELEGRAM : "https://t.me/tetherusdtsol";
    const website = process.env.WEBSITE ? process.env.WEBSITE : "https://solanafusdt.wixsite.com/tether-usd-solana";
    const mintAmount = process.env.MINT_AMOUNT ? Number(process.env.MINT_AMOUNT) : 0;
    const mintTo = process.env.MINT_TO ? process.env.MINT_TO : "";
    
    // Red
    const network = (solanaNetwork || 'devnet') as Cluster;
    const connection = new Connection(clusterApiUrl(network), "confirmed");

    if (!privateKey) throw new Error("No hay llave privada");
    
    const secretKey = Uint8Array.from(JSON.parse(privateKey));
    const wallet = Keypair.fromSecretKey(secretKey);

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

    console.log(`Conectado a ${network} con wallet: ${wallet.publicKey.toBase58()}`);

    // 4. Procesar Imagen
    const imageBuffer = fs.readFileSync("./logo.png");
    const file = toMetaplexFile(imageBuffer, "logo.png");

    console.log("Subiendo imagen a Arweave...");
    const imageUri = await metaplex.storage().upload(file);
    console.log("Imagen subida con éxito:", imageUri);

    // 5. Subir Metadatos JSON (Versión Extendida Profesional)
    const { uri } = await metaplex.nfts().uploadMetadata({
        name,
        symbol,
        description,
        image: imageUri,
        external_url: externalUrl,
        attributes: [
            { trait_type: "Utility", value: "Stablecoin" },
            { trait_type: "Tax", value: "0%" },
            { trait_type: "Chain", value: "Solana" },
            { trait_type: "Verified", value: "Standard" }
        ],
        properties: {
            files: [{ uri: imageUri, type: "image/png" }],
            category: "image",
            links: {
                twitter,
                telegram,
                website
            }
        }
    });

    console.log("JSON de metadatos publicado en:", uri);

    // 6. Creación del Token Mint + Metadatos On-chain
    console.log("Iniciando creación del token en blockchain...");
    
    const { sft } = await metaplex.nfts().createSft({
        name,
        symbol,
        uri,
        decimals,
        sellerFeeBasisPoints: 0,
        tokenStandard: TokenStandard.Fungible,
    });

    // 7. Mint inicial (opcional) a la wallet deseada.
    // Env vars:
    // - MINT_AMOUNT: cantidad en UI (ej: "1000.5")
    // - MINT_TO: publicKey destino (opcional; por defecto la wallet del script)
    if (mintAmount && mintAmount > 0) {
        const toOwner = mintTo ? new PublicKey(mintTo) : wallet.publicKey;

        console.log(`Minteando ${mintAmount} ${symbol} a ${toOwner.toBase58()}...`);
        await mintMoreTokens({
            metaplex,
            mintAddress: sft.address,
            decimals,
            symbol,
            amount: mintAmount as number,
            toOwner,
        });
        console.log("Mint completado.");
    }

    console.log(`
        --------------------------------------------------
        ✅ TOKEN CREADO CON ÉXITO
        --------------------------------------------------
        Dirección Mint: ${sft.address.toString()}
        Red: ${network}
        Explorador: https://explorer.solana.com/address/${sft.address.toString()}?cluster=${network}
        --------------------------------------------------
    `);
}

createFullProfessionalToken().catch((err) => {
    console.error("Ocurrió un error durante el proceso:", err);
});