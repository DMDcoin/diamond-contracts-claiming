
export interface BalanceV3 {
    dmdv3Address: string,
    value: string;
}

export interface ClaimingBalance extends BalanceV3 {
    dmdv4Address: string;
    signature: string;
    postfix?: string;
}

export interface ClaimingDataSet {
    // if true, the BTC signing prefix is used, otherwise the DMD signing prefix is used
    isDMDSigned: boolean;
    // the seedphrase used to sign the message, just in case for reconstructing the test.
    seedphrase: string | undefined;
    // the interlude of the message, Not the prefix used by the signing (isDMDSigned determines if BTC or DMD signing prefix is used)  
    messagePrefix: string;

    // the balances with signatures to test
    balances: ClaimingBalance[];
}
