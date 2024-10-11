import hre from "hardhat";
import { CryptoSol } from "../api/src/cryptoSol";
import { ClaimContract, ClaimContract__factory } from "../typechain-types";
import { stringToUTF8Hex } from "../api/src/cryptoHelpers";
import { BalanceV3 } from "../api/data/interfaces";

let ethers = hre.ethers;


//const prefix = "TESTNET dmd v4 coins are voluntary distributed towards DMD v3 snapshot coin balance owners based on the ruleset described in the open source contracts and whitepaper by using the claiming dapp u agree to this rulesets. target dmd v4 claiming address: ";
// const prefix = "";
const prefix = "claim alpha4 to: ";


async function main() {

    let claimBeneficorAddress = "0x2000000000000000000000000000000000000001";
    let beneficorDAOAddress = "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0";

    //let dillute1 =
    let now = (Date.now() / 1000).toFixed(0);

    let signer = (await hre.ethers.getSigners())[0];

    

    console.log("using signer:", signer.address);
    const signerBalance = await ethers.provider.getBalance(signer.address);
    console.log("balance:", signerBalance);

    if (signerBalance == BigInt(0)) {
      console.error("No Balance for this signer");
      return;
    }

    const hour = 60 * 60;
    const day = hour * 24;
    const dillute1 = now + 7 * day;
    const dillute2 = dillute1 + 7 * day;
    const dillute3 = dillute2 + 7 * day;

    const contractFactory = await ethers.getContractFactory("ClaimContract");
    
    const prefixHex = stringToUTF8Hex(prefix);
    console.log("prefixHex", prefixHex);
    const claimContractAny : any = await contractFactory.deploy(claimBeneficorAddress, beneficorDAOAddress, prefixHex, dillute1, dillute2, dillute3);
    const claimContract = claimContractAny as ClaimContract;
    
    await claimContract.waitForDeployment();
    let claimContractAddress = await claimContract.getAddress();
    console.log('claim contract deployed to:', claimContractAddress);
    console.log(`trying to verify.`);
    console.log(`npx command to verify localy - if the automated command fails:`); 
    console.log(`npx hardhat verify --network alpha4 ${claimContractAddress} ${claimBeneficorAddress} ${beneficorDAOAddress} ${prefixHex} ${dillute1} ${dillute2} ${dillute3}` );


    let cryptoSol = new CryptoSol(claimContract);
    cryptoSol.setLogDebug(true);
    // it doesnt need to be super accurate, we can work with floating point numbers here.
    let allCoins = 3824716;

    //let allCoins = 1;
    // - 75% early
    // - 5% mid
    // - 5% late
    // - 15% never

    let totalEarly = allCoins * 0.75;
    let totalMid = allCoins * 0.05;
    let totalLate = allCoins * 0.05;
    let totalNever = allCoins * 0.15;

    let earlyAccounts = [
      "dbnJAWXKYvmoqV5bonJdgY3yuzHgrdHJQs",
      "dEaTZND5nXeZRZgJt1z6HVmP7mtZ3demQK",
      "dEx99xwAmqZtZtL6VrtxNv5pH2dtk6kTMH",
      "dc71fVvE17UEZEZb7qbQmaLWm3D15QkB4V",
      "dTmpgqgC2qoc9bitKCdVMM19gyJNfMudBR",
      "dFQHpmkSScf9WXcyzDWK25BM62N218ViS7",
      "dJU7z5oXd5ZsXZybRWadHnUzFgCY5ukZU5",
      "dYUyrALxXrzpwyE41cntKHgPS4BYSB3rQX",
      "dY3DefvBW4ySwfqJdPUVrmMyqDVW6cPJbd",
      "dQkNJHJtow742w1Pmm3txRJQ6xt9bQaxb7",
      "dHN8MdcZQVedNp3xY5mFvr8gLDeRkxR116",
      "dSKqzw53y8Jgk4Y82usx3PWGx38yScpm7T",
      "dDrm7QnGkLubQyNtnbbg7ZvkTEfTwAFaoq",
      "dQVvs2Kjnhijge1BvHmejhV6GJRsiw8DCc"
    ];

    // let unclaimed = [
    //   "dEx99xwAmqZtZtL6VrtxNv5pH2dtk6kTMH",
    //   "dTmpgqgC2qoc9bitKCdVMM19gyJNfMudBR",
    //   "dFQHpmkSScf9WXcyzDWK25BM62N218ViS7",
    //   "dHN8MdcZQVedNp3xY5mFvr8gLDeRkxR116",
    //   "dSKqzw53y8Jgk4Y82usx3PWGx38yScpm7T",
    //   "dDrm7QnGkLubQyNtnbbg7ZvkTEfTwAFaoq",
    //   "dQVvs2Kjnhijge1BvHmejhV6GJRsiw8DCc"
    // ];


    let toWeiString = (value: number) => {

      let num = value *  Number(ethers.WeiPerEther);
      console.log(num);
      let big = BigInt(num);
      console.log(big);
      let result = ethers.formatUnits(big, 0);
      console.log(result);
      return result;
    }

    let earlyBalances : BalanceV3[] = earlyAccounts.map((a) => { return {dmdv3Address: a, value: toWeiString(totalEarly / earlyAccounts.length) }; });


    // 0xbC81e4c79447F73022B02203b14a526f64B821E0
    let balances : BalanceV3[] = [
      // designed for early.
      ...earlyBalances,
      // designed for mid.
      { dmdv3Address: "dNddYBwd1xeu2snmJt4YxMcG2qWChcHCNt", value: toWeiString(totalMid) },
      // designed for late.
      { dmdv3Address: "dPmptc1PYyNn4kpMgqNz5S1Wj3JFEs6fqk", value: toWeiString(totalLate)},
      // designed for never.
      { dmdv3Address: "dHRKrnhhtGTiNRrCpLkmvhUKUWNB247mah", value: toWeiString(totalNever)},
    ];

    let sponsor = (await ethers.getSigners())[0];
    await cryptoSol.fillBalances(sponsor, balances);
    
    await hre.run("verify:verify", {
        address: claimContractAddress,
        constructorArguments: [
            claimBeneficorAddress,
            beneficorDAOAddress,
            prefixHex,
            dillute1,
            dillute2,
            dillute3,
        ],
      });
}

main();


