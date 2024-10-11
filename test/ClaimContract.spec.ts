import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import EC from "elliptic";
import BN from "bn.js";

import { ClaimContract } from "../typechain-types";
import { CryptoJS } from "../api/src/cryptoJS";
import { ensure0x, hexToBuf, remove0x, stringToUTF8Hex } from "../api/src/cryptoHelpers";
import { getTestSignatures } from "./fixtures/signature";
import { getTestBalances, getTestBalances_DMD_cli_same_address, getTestBalances_DMD_cli, getTestBalances_DMD_with_prefix, getTestBalances_dillution, getTestBalancesAlpha3 } from "./fixtures/balances";
import { CryptoSol } from "../api/src/cryptoSol";
import { BalanceV3, ClaimingBalance, ClaimingDataSet } from "../api/data/interfaces";
import { getTestBalancesFromTestdata } from "./fixtures/testdata";


console.log("Large tests are disabled as default since a lot of CI Pipelines do not allow long running tests.");
console.log("Specify ENV variable as CLAIMING_TEST_RUN_LARGE=1 to enable large tests.");

let runLargeTests = false;

if (process.env.CLAIMING_TEST_RUN_LARGE) {
    if (process.env.CLAIMING_TEST_RUN_LARGE == "1" || process.env.CLAIMING_TEST_RUN_LARGE === "true") {
        runLargeTests = true;
    }
}

function getDilluteTimestamps(): { dillute1: number, dillute2: number, dillute3: number } {
    let now = Math.floor(Date.now() / 1000);
    let dillute1 = now + (86400 * 2 * 31) + 86400 * 30;
    let dillute2 = now + (86400 * 3 * 31) + (86400 * 3 * 30);
    let dillute3 = now + (86400 * 4 * 365) + (86400 * 366);
    return { dillute1, dillute2, dillute3 };

}

describe('ClaimContract', () => {

    let signers: SignerWithAddress[];

    let lateClaimBeneficorAddress: string;
    let lateClaimBeneficorDAO: string;

    let cryptoJS: CryptoJS;

    async function deployClaiming(claimBeneficorAddress: string, beneficorDAOAddress: string, prefix: string) {
        const contractFactory = await ethers.getContractFactory("ClaimContract");
        let dilluteTimestamps = getDilluteTimestamps();
        let prefixHex = stringToUTF8Hex(prefix);

        const claimContract = await contractFactory.deploy(claimBeneficorAddress, beneficorDAOAddress, prefixHex, dilluteTimestamps.dillute1, dilluteTimestamps.dillute2, dilluteTimestamps.dillute3);
        await claimContract.waitForDeployment();

        // why we need to bypass type checks here ?
        return (claimContract as any) as ClaimContract;
    }

    async function deployFixtureWithNoPrefix(): Promise<{ claimContract: ClaimContract }> {
        return deployFixture('');
    }

    async function deployFixture(prefixHex: string): Promise<{ claimContract: ClaimContract }> {

        let claimContract = await deployClaiming(lateClaimBeneficorAddress, lateClaimBeneficorDAO, prefixHex);
        return { claimContract };
    }

    before(async () => {
        signers = await ethers.getSigners();

        // this 2 address will are contracts addresses in Diamond.
        // this ClaimingContract contract only fills those 2 addresses.
        // the example address are also the address the deployment of the DAO and the Core contract will happen on the real network.

        lateClaimBeneficorAddress = "0x2000000000000000000000000000000000000001";
        lateClaimBeneficorDAO = "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0";

        cryptoJS = new CryptoJS();
    });

    describe("deployment", () => {

        it('should deploy contract', async () => {
            const contractFactory = await ethers.getContractFactory("ClaimContract");

            // get current timestamp:
            // dillute1 =  deploymentTimestamp + (1 days * 2 * 31) + 1 days * 30;
            // dillute2 =  deploymentTimestamp + (1 days * 3 * 31) + (1 days * 3 * 30);
            // dillute3 =  deploymentTimestamp + (YEAR_IN_SECONDS * 4) + LEAP_YEAR_IN_SECONDS;

            let dilluteTimestamps = getDilluteTimestamps();

            const contract = await contractFactory.deploy(
                lateClaimBeneficorAddress,
                lateClaimBeneficorDAO,
                '0x',
                dilluteTimestamps.dillute1,
                dilluteTimestamps.dillute2,
                dilluteTimestamps.dillute3
            );


            expect(await contract.waitForDeployment());
        });

        it('should not deploy with wrong constructor arguments', async () => {
            const contractFactory = await ethers.getContractFactory("ClaimContract");

            // get current timestamp:
            // dillute1 =  deploymentTimestamp + (1 days * 2 * 31) + 1 days * 30;
            // dillute2 =  deploymentTimestamp + (1 days * 3 * 31) + (1 days * 3 * 30);
            // dillute3 =  deploymentTimestamp + (YEAR_IN_SECONDS * 4) + LEAP_YEAR_IN_SECONDS;

            let dilluteTimestamps = getDilluteTimestamps();

            await expect(contractFactory.deploy(
                lateClaimBeneficorAddress,
                lateClaimBeneficorDAO,
                '0x',
                '0x0', // <-- First timestamp in the past.
                dilluteTimestamps.dillute1,
                dilluteTimestamps.dillute3
            )).to.be.revertedWithCustomError(contractFactory, "InitializationErrorDiluteTimestamp1");

            await expect(contractFactory.deploy(
                lateClaimBeneficorAddress,
                lateClaimBeneficorDAO,
                '0x',
                dilluteTimestamps.dillute2,
                dilluteTimestamps.dillute1, // <-- wrong order
                dilluteTimestamps.dillute3
            )).to.be.revertedWithCustomError(contractFactory, "InitializationErrorDiluteTimestamp2");


            await expect(contractFactory.deploy(
                lateClaimBeneficorAddress,
                lateClaimBeneficorDAO,
                '0x',
                dilluteTimestamps.dillute1,
                dilluteTimestamps.dillute3,
                dilluteTimestamps.dillute2 // <-- wrong order
            )).to.be.revertedWithCustomError(contractFactory, "InitializationErrorDiluteTimestamp3");

            await expect(contractFactory.deploy(
                lateClaimBeneficorAddress,
                ethers.ZeroAddress, // <-- DaoAddress Zero
                '0x',
                dilluteTimestamps.dillute1,
                dilluteTimestamps.dillute2,
                dilluteTimestamps.dillute3
            )).to.be.revertedWithCustomError(contractFactory, "InitializationErrorDaoAddressNull");

            await expect(contractFactory.deploy(
                ethers.ZeroAddress, // <-- Reinsert Pot Zero 
                lateClaimBeneficorDAO,
                '0x',
                dilluteTimestamps.dillute1,
                dilluteTimestamps.dillute2,
                dilluteTimestamps.dillute3
            )).to.be.revertedWithCustomError(contractFactory, "InitializationErrorReinsertPotAddressNull");
        });
    });

    describe("cryptographics", () => {
        it('should correctly calculate address checksum', async () => {
            const { claimContract } = await helpers.loadFixture(deployFixtureWithNoPrefix);

            const address = '0xfec7b00dc0192319dda0c777a9f04e47dc49bd18';
            const addressWithChecksum = '0xfEc7B00DC0192319DdA0c777A9F04E47Dc49bD18';

            const calcAddressResult = await claimContract.calculateAddressString(address);

            const buffer = Buffer.from(remove0x(calcAddressResult), 'hex');
            const calcResult = buffer.toString('utf8');

            expect(calcResult).to.be.equal(addressWithChecksum, 'checksum must be calculated in a correct ways.');
        });

        it('should create correct claim message', async () => {
            const { claimContract } = await helpers.loadFixture(deployFixtureWithNoPrefix);

            const address = '0x70A830C7EffF19c9Dd81Db87107f5Ea5804cbb3F';
            const resultJS = ensure0x(cryptoJS.getDMDSignedMessage(address).toString('hex'));

            const postfixHex = stringToUTF8Hex('');
            const result = await claimContract.createClaimMessage(address, postfixHex);

            expect(result).to.be.equal(resultJS);
        });


        it('should create correct claim message dmd with prefix', async () => {
            const { claimContract } = await helpers.loadFixture(deployFixtureWithNoPrefix);

            const prefix = '';
            const address = '0x70A830C7EffF19c9Dd81Db87107f5Ea5804cbb3F';
            const resultJS = ensure0x(cryptoJS.getDMDSignedMessage(prefix + address).toString('hex'));

            const postfixHex = stringToUTF8Hex('');
            const result = await claimContract.createClaimMessage(address, postfixHex);

            expect(result).to.be.equal(resultJS);
        });


        it('should convert pub key to eth address', async () => {
            const { claimContract } = await helpers.loadFixture(deployFixtureWithNoPrefix);

            // BIP39 Mnemonic: "hello slim hope" - really, i got this Mnemonic from RNG...
            // address 0: 0x7af37454aCaB6dB76c11bd33C94ED7C0b7A60B2a
            // Public:    0x03ff2e6a372d6beec3b02556971bfc87b9fb2d7e27fe99398c11693571080310d8
            // Private:   0xc99dd56045c449952e16388925455cc32e4eb180f2a9c3d2afd587aaf1cceda5

            const expectedAddress = '0x7af37454aCaB6dB76c11bd33C94ED7C0b7A60B2a';
            const inputPrivateKey = 'c99dd56045c449952e16388925455cc32e4eb180f2a9c3d2afd587aaf1cceda5';

            var ec = new EC.ec('secp256k1');
            var G = ec.g; // Generator point
            var pk = new BN(inputPrivateKey, 'hex'); // private key as big number
            var pubPoint = G.mul(pk); // EC multiplication to determine public point

            var x = pubPoint.getX().toBuffer(); //32 bit x co-ordinate of public point
            var y = pubPoint.getY().toBuffer(); //32 bit y co-ordinate of public point

            const result = await claimContract.pubKeyToEthAddress(x, y);

            expect(result).to.equal(expectedAddress);
        });

        it('should convert BTC address to RIPE result', async () => {
            // https://royalforkblog.github.io/2014/08/11/graphical-address-generator/
            // passphrase: bit.diamonds

            const address = '1Q9G4T5rLaf4Rz39WpkwGVM7e2jMxD2yRj';

            const expectedRipeResult = 'FDDACAAF7D90A0D7FC90106C3A64ED6E3A2CF859'.toLowerCase();
            const realRipeResult = cryptoJS.dmdAddressToRipeResult(address).toString('hex');

            expect(realRipeResult).to.equal(expectedRipeResult);
        });

        it('should convert public key to to Bitcoin Address', async () => {
            const { claimContract } = await helpers.loadFixture(deployFixtureWithNoPrefix);

            // https://royalforkblog.github.io/2014/08/11/graphical-address-generator/
            // passphrase: bit.diamonds
            const publicKeyHex = '035EF44A6382FABDCB62425D68A0C61998881A1417B9ED068513310DBAE8C61040';
            const expectedAddress = '1Q9G4T5rLaf4Rz39WpkwGVM7e2jMxD2yRj';

            const { x, y } = cryptoJS.getXYfromPublicKeyHex(publicKeyHex);



            const essentialPart = await claimContract.publicKeyToDMDAddress(
                ensure0x(x.toString('hex')),
                ensure0x(y.toString('hex'))
            );

            const bs58Result = cryptoJS.bitcoinAddressEssentialToFullQualifiedAddress(
                essentialPart,
                '00'
            );

            expect(bs58Result).to.equal(expectedAddress);

            console.log();
            // we are also cross checking the result with the result from the cryptoJS library,
            // (that uses bitcoin payments internaly to verify)
            const addressFromCryptJS = cryptoJS.publicKeyToDMDAddress(publicKeyHex);
            expect(bs58Result).to.equal(addressFromCryptJS);
        });

        it('JS: should recover public key from signature', async () => {
            //https://royalforkblog.github.io/2014/08/11/graphical-address-generator/
            //passphrase: bit.diamonds

            const message = "0x70A830C7EffF19c9Dd81Db87107f5Ea5804cbb3F";
            const signatureBase64 = "IBHr8AT4TZrOQSohdQhZEJmv65ZYiPzHhkOxNaOpl1wKM/2FWpraeT8L9TaphHI1zt5bI3pkqxdWGcUoUw0/lTo=";
            const key = cryptoJS.getPublicKeyFromSignature(signatureBase64, message, false);

            expect(key.x).equal("0x5EF44A6382FABDCB62425D68A0C61998881A1417B9ED068513310DBAE8C61040".toLowerCase());
            expect(key.y).equal("0x99523EB43291A1067FA819AA5A74F30810B19D15F6EDC19C9D8AA525B0F6C683".toLowerCase());
            expect(key.publicKey).equal("0x035EF44A6382FABDCB62425D68A0C61998881A1417B9ED068513310DBAE8C61040".toLowerCase());
        });

        it('JS: should recover public key from signatures, test signatures set.', async () => {
            // larger test
            // But with multi signatures of the same key.
            // in order to cover different signatures variations,
            // like short S and short R

            // https://royalforkblog.github.io/2014/08/11/graphical-address-generator/
            // passphrase: bit.diamonds

            // signatures created with: https://reinproject.org/bitcoin-signature-tool/#sign

            const message = "0x70A830C7EffF19c9Dd81Db87107f5Ea5804cbb3F";
            const signaturesBase64 = getTestSignatures();

            for (let index = 0; index < signaturesBase64.length; index++) {
                const signatureBase64 = signaturesBase64[index];
                const key = cryptoJS.getPublicKeyFromSignature(signatureBase64, message, false);

                expect(key.x).equal("0x5EF44A6382FABDCB62425D68A0C61998881A1417B9ED068513310DBAE8C61040".toLowerCase());
                expect(key.y).equal("0x99523EB43291A1067FA819AA5A74F30810B19D15F6EDC19C9D8AA525B0F6C683".toLowerCase());
                expect(key.publicKey).equal("0x035EF44A6382FABDCB62425D68A0C61998881A1417B9ED068513310DBAE8C61040".toLowerCase());
            }
        });

        async function runAddAndClaimTests(testSet: ClaimingDataSet, debug = false) {

            let deployFixtureSpecified = () => {
                return deployFixture(testSet.messagePrefix);
            };

            const { claimContract } = await helpers.loadFixture(deployFixtureSpecified);
            const caller = signers[0];
            const balances = testSet;

            let cryptoSol = new CryptoSol(claimContract);

            if (debug) {
                cryptoSol.setLogDebug(true);
            }

            await cryptoSol.fillBalances(caller, balances.balances);

            for (const balance of balances.balances) {
                let balanceBeforeClaim = await ethers.provider.getBalance(balance.dmdv4Address);
                await cryptoSol.claim(balance.dmdv3Address, balance.dmdv4Address, balance.signature, balance.postfix ?? "");
                let balanceAfterClaim = await ethers.provider.getBalance(balance.dmdv4Address);

                let expectedBalance = ethers.toBigInt(balance.value) + balanceBeforeClaim;
                expect(balanceAfterClaim).to.equal(expectedBalance, 'Balance of DMDv4 adress matches defined Balance.');
            }
        }

        describe("balance", async function () {

            it('fill() a balance testset', async () => {
                let deployFreshFixtureForBalanceTest = () => deployFixtureWithNoPrefix();
                const { claimContract } = await helpers.loadFixture(deployFreshFixtureForBalanceTest);

                const caller = signers[0];
                const testbalances = getTestBalances();

                let cryptoSol = new CryptoSol(claimContract);


                let expectedTotalBalance = await cryptoSol.fillBalances(caller, testbalances);

                const totalBalance = await ethers.provider.getBalance(await claimContract.getAddress());
                expect(totalBalance).to.equal(expectedTotalBalance, 'Balance of contract should be the total of all added funds.');

                for (const balance of testbalances) {
                    const currentBalance = await claimContract.balances(cryptoJS.dmdAddressToRipeResult(balance.dmdv3Address));
                    expect(currentBalance.toString()).to.equal(balance.value, 'Balance of DMDv3 adress matches defined Balance.');
                }
            });
        });

        describe("dilution", async function () {

            // it("dilute a testset", async () => {

            //     let testbalances = getTestBalances_BTC();

            //     for (let balance of testbalances.balances) {
            //         balance.value
            //     }
            // });

            // DMD claiming is known to fail.
            // it("claiming DMD", async () => {
            //     await runAddAndClaimTests(getTestBalances_DMD());
            // });
        });

        //             117.869,94
        // 70.721,96
        // 165.017,91

        describe("DMD Diamond", async function () {
            it("DMD Signatures from same address point to same public key.", async () => {

                let testset = getTestBalances_DMD_cli_same_address();
                let x = "";
                let y = "";

                const { claimContract } = await helpers.loadFixture(deployFixtureWithNoPrefix);
                //let cryptoSol = new CryptoSol(claimContract);

                for (let balance of testset.balances) {

                    let key = cryptoJS.getPublicKeyFromSignature(balance.signature, balance.dmdv4Address, true);

                    //cryptoJS.publicKeyToBTCStyleAddress(key.x, key.y, true);
                    //cryptoJS.bitcoinAddressEssentialToFullQualifiedAddress()
                    if (x === "") {

                        x = key.x;
                        y = key.y;
                    } else {
                        expect(x).to.equal(key.x, "Public key is not the same for all signatures.");
                        expect(y).to.equal(key.y, "Public key is not the same for all signatures.");
                    }
                }
            });

            it("rejecting double add balances for defined DMD address", async () => {

                const { claimContract } = await helpers.loadFixture(deployFixtureWithNoPrefix);
                await expect(runAddAndClaimTests(getTestBalances_DMD_cli_same_address())).to.revertedWithCustomError(claimContract, "FillErrorAccountAlreadyDefined");
            });

            it("DMD address building from ripe.", async () => {
                let balances = getTestBalances();

                for (let balance of balances) {
                    const ripeResult = cryptoJS.dmdAddressToRipeResult(balance.dmdv3Address);
                    const dmdAddressFromRipe = cryptoJS.ripeToDMDAddress(ripeResult);
                    expect(dmdAddressFromRipe).to.equal(balance.dmdv3Address);
                }
            });
        });


        describe("claiming", async function () {

            // DMD claiming is known to fail.
            it("claiming DMD", async () => {
                await runAddAndClaimTests(getTestBalances_DMD_cli());
            });

            it("claiming DMD with prefix", async () => {
                await runAddAndClaimTests(getTestBalances_DMD_with_prefix());
            });

            it("claiming DMD regression known high x high y public keys", async () => {
                await runAddAndClaimTests(getTestBalancesFromTestdata("small"));
            });


            it("claiming DMD regression from known low x public keys", async () => {
                await runAddAndClaimTests(getTestBalancesFromTestdata("known_x_00"));
            });


            it("claiming DMD regression from known low y public keys", async () => {
                await runAddAndClaimTests(getTestBalancesFromTestdata("known_y_00"));
            });

            it("Claiming DMD with postfixes", async () => {
                await runAddAndClaimTests(getTestBalancesFromTestdata("with_postfixes"));
            });

            it("Claiming DMD with long prefix", async () => {
                await runAddAndClaimTests(getTestBalancesFromTestdata("long_prefix"));
            });

            if (runLargeTests) {
                it("Claiming DMD large test: balances_1k", async () => {
                    await runAddAndClaimTests(getTestBalancesFromTestdata("balances_1k"));
                }).timeout(60_000); // maximum 1 minutes for this test.

                it("Claiming DMD large test: balances_50k", async () => {
                    await runAddAndClaimTests(getTestBalancesFromTestdata("balances_50k"));
                }).timeout(60_000 * 60); // maximum 1 hour for this test.

            }
        });


        describe("Dilution", function () {
            let claimContract: ClaimContract;
            let sponsor: SignerWithAddress;
            let totalAmountInClaimingPot: bigint = BigInt(0);

            it("should dilute balances and pay out correctly", async function () {

                [sponsor] = await ethers.getSigners();
                let testBalances = getTestBalances_dillution();
                claimContract = (await deployFixture(testBalances.messagePrefix)).claimContract;

                let sol = new CryptoSol(claimContract);
                // sol.setLogDebug(true);

                totalAmountInClaimingPot = await sol.fillBalances(sponsor, testBalances.balances);

                // Try to dilute before first dilution period - should fail
                await expect(claimContract.dilute1()).to.be.revertedWithCustomError(
                    claimContract,
                    "DiluteTimeNotReached"
                );

                let claimingBalances = getTestBalances_dillution();
                const [claimersEarly, claimersMid, claimersLate, claimersNever] = claimingBalances.balances;


                let claimPreconfiguredBalance = async (balance: ClaimingBalance) => {
                    // console.log("claiming:", balance);
                    await sol.claim(balance.dmdv3Address, balance.dmdv4Address, balance.signature, "");
                }

                await claimPreconfiguredBalance(claimersEarly);

                // claiming all the coins that are expected to claim within first claiming period here.
                // those will receive 100% of coins
                // await sol.claim(claimersEarly.dmdv3Address, claimersEarly.dmdv4Address, claimersEarly.signature, "");

                // does the early claimer have the exact amount of coins than he should have ?
                let claimerBalanceEarly = await ethers.provider.getBalance(claimersEarly.dmdv4Address);
                expect(claimerBalanceEarly).to.be.equal(BigInt(claimersEarly.value));

                // a second claim must not be possible.
                await expect(sol.claim(claimersEarly.dmdv3Address, claimersEarly.dmdv4Address, claimersEarly.signature, "")).to.be.revertedWithCustomError(claimContract, "ClaimErrorNoBalance");

                // we can not execute any of the dillution functions, because not enough time passed by.
                await expect(claimContract.dilute1()).to.be.revertedWithCustomError(claimContract, "DiluteTimeNotReached");
                await expect(claimContract.dilute2()).to.be.revertedWithCustomError(claimContract, "DiluteTimeNotReached");
                await expect(claimContract.dilute3()).to.be.revertedWithCustomError(claimContract, "DiluteTimeNotReached");

                // Fast forward time to after first dilution period.
                await helpers.time.increaseTo((await claimContract.dilute_s1_75_timestamp()) + BigInt(1));

                // time has come, everybody can now call dilute1().
                // a programmed service will wait for this event and trigger the execution.
                await claimContract.dilute1();

                // but it is only able to be triggered once
                await expect(claimContract.dilute1()).to.be.revertedWithCustomError(claimContract, "DiluteAllreadyHappened");

                // dilute 2 + 3 are still not triggerable.
                await expect(claimContract.dilute2()).to.be.revertedWithCustomError(claimContract, "DiluteTimeNotReached");
                await expect(claimContract.dilute3()).to.be.revertedWithCustomError(claimContract, "DiluteTimeNotReached");


                // dilute1() pays out not claimed coins to the DAO and the reinsert pot.
                // both will get 50% each.

                // not payed out coins is the dilution factor of 25% of the total balance of all remaining claims.

                const getRemainingBalance = (notClaimedBalances: BalanceV3[]) => {
                    return notClaimedBalances.map(b => BigInt(b.value)).reduce((a, b) => a + b);
                }

                const remainingBalanceToClaimAfterEarly = getRemainingBalance([claimersMid, claimersLate, claimersNever]);

                // 25% of the balances that have not been claimed should go to the pots.
                let expectedTotalPotBalances1 = remainingBalanceToClaimAfterEarly / BigInt(4);

                // hint: because 1 can not be divided by 2, this test wont work with Odd Numbers.
                let expectedDaoBalance1 = expectedTotalPotBalances1 / BigInt(2);
                let expectedReinsertPotBalance1 = expectedTotalPotBalances1 / BigInt(2);

                // we can calculate expectations for dilute events already here.

                // at the second event, it is 50%. 
                // 25% already got claimed,
                // so it is another 25%, and we have to divide 4 again.
                let expectedDilution2 = getRemainingBalance([claimersLate, claimersNever]) / BigInt(4);
                let expectedDaoBalance2 = expectedDaoBalance1 + expectedDilution2 / BigInt(2);
                let expectedReinsertPotBalance2 = expectedReinsertPotBalance1 + expectedDilution2 / BigInt(2);

                // at the third event, 100% will get diluted.
                // since 25% + 25% of the funds already got diluted,
                // the expected dilution value is 50% of the rest of the coins. 
                let expectedDilution3 = getRemainingBalance([claimersNever]) / BigInt(2);
                let expectedDaoBalance3 = expectedDaoBalance2 + expectedDilution3 / BigInt(2);
                let expectedReinsertPotBalance3 = expectedReinsertPotBalance2 + expectedDilution3 / BigInt(2);

                // expectedDaoBalance1
                expect(expectedDaoBalance1).to.be.equal(await ethers.provider.getBalance(lateClaimBeneficorDAO));
                expect(expectedReinsertPotBalance1).to.be.equal(await ethers.provider.getBalance(lateClaimBeneficorAddress));

                await claimPreconfiguredBalance(claimersMid);

                let claimerBalanceMid = await ethers.provider.getBalance(claimersMid.dmdv4Address);

                // claimer receive 75%.
                let expectedClaimerBalanceMid = BigInt(claimersMid.value) * BigInt(3) / BigInt(4);
                expect(claimerBalanceMid).to.be.equal(expectedClaimerBalanceMid);

                // Fast forward time to after second dilution period.
                await helpers.time.increaseTo((await claimContract.dilute_s2_50_timestamp()) + BigInt(1));


                // another 25% of the funds got diluted.
                await claimContract.dilute2();

                // check the balances of the DAO and reinsert contracts.
                expect(expectedDaoBalance2).to.be.equal(await ethers.provider.getBalance(lateClaimBeneficorDAO));
                expect(expectedReinsertPotBalance2).to.be.equal(await ethers.provider.getBalance(lateClaimBeneficorAddress));

                await helpers.time.increaseTo((await claimContract.dilute_s3_0_timestamp()) + BigInt(1));

                await claimPreconfiguredBalance(claimersLate);

                // the remaining 50% of the funds get diluted.
                await claimContract.dilute3();


                // check the balances of the DAO and reinsert contracts.
                expect(expectedDaoBalance3).to.be.equal(await ethers.provider.getBalance(lateClaimBeneficorDAO));
                expect(expectedReinsertPotBalance3).to.be.equal(await ethers.provider.getBalance(lateClaimBeneficorAddress));

                // Try to dilute after all dilutions - should still fail, there most not be any reset.
                // NOTE: if someone sends coin to that contract, this funds will be lost.
                await expect(claimContract.dilute1()).to.be.revertedWithCustomError(claimContract, "DiluteAllreadyHappened");
                await expect(claimContract.dilute2()).to.be.revertedWithCustomError(claimContract, "DiluteAllreadyHappened");
                await expect(claimContract.dilute3()).to.be.revertedWithCustomError(claimContract, "DiluteAllreadyHappened");
            });
        });

    });
});