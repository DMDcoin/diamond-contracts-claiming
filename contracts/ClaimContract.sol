pragma solidity >=0.8.1 <0.9.0;

contract ClaimContract {
    enum AddressType {
        LegacyCompressed
    }

    bytes16 internal constant HEX_DIGITS = "0123456789abcdef";

    /* Constants for preparing the claim message text */
    uint8 internal constant ETH_ADDRESS_BYTE_LEN = 20;
    uint8 internal constant ETH_ADDRESS_HEX_LEN = ETH_ADDRESS_BYTE_LEN * 2;
    uint8 internal constant CLAIM_PARAM_HASH_BYTE_LEN = 12;
    uint8 internal constant CLAIM_PARAM_HASH_HEX_LEN = CLAIM_PARAM_HASH_BYTE_LEN * 2;

    uint8 internal constant BITCOIN_SIG_PREFIX_LEN = 24;
    bytes24 internal constant BITCOIN_SIG_PREFIX_STR = "Bitcoin Signed Message:\n";

    uint8 internal constant DIAMOND_SIG_PREFIX_LEN = 24;
    bytes24 internal constant DIAMOND_SIG_PREFIX_STR = "Diamond Signed Message:\n";

    uint256 public constant YEAR_IN_SECONDS = 31536000;
    uint256 public constant LEAP_YEAR_IN_SECONDS = 31622400;

    uint256 public dilute_s1_75_timestamp;
    uint256 public dilute_s2_50_timestamp;
    uint256 public dilute_s3_0_timestamp;

    mapping(bytes20 => uint256) public balances;

    /* solhint-disable var-name-mixedcase */

    // tracks if dilution for 75% was executed
    bool public dilution_s1_75_executed;

    // tracks if dilution for 50% was executed
    bool public dilution_s2_50_executed;

    // tracks if dilution for 0% was executed
    bool public dilution_s3_0_executed;

    /* solhint-enable var-name-mixedcase */

    uint256 public deploymentTimestamp;

    address payable public lateClaimBeneficorAddressReinsertPot;

    address payable public lateClaimBeneficorAddressDAO;

    /// @dev the prefix for the signing message.
    /// A Prefix for the signing message can be used to separate different message between different contracts/networks
    /// e.g.: "claim to testnet" for indicating that this is only a testnet claim.
    /// the prefix is part of the signed message .
    bytes public prefixStr;

    event Claim(
        bytes20 indexed _from,
        address _to,
        uint256 amount,
        uint256 _nominator,
        uint256 _denominator
    );

    constructor(
        address payable _lateClaimBeneficorAddressReinsertPot,
        address payable _lateClaimBeneficorAddressDAO,
        bytes memory _prefixStr,
        uint256 _dilute_s1_75_timestamp,
        uint256 _dilute_s2_50_timestamp,
        uint256 _dilute_s3_0_timestamp
    ) {
        require(
            _lateClaimBeneficorAddressReinsertPot != address(0),
            "Beneficor Address Reinsert Pot must not be 0x0"
        );
        require(
            _lateClaimBeneficorAddressDAO != address(0),
            "Beneficor Address DAO must not be 0x0"
        );

        lateClaimBeneficorAddressReinsertPot = _lateClaimBeneficorAddressReinsertPot;
        lateClaimBeneficorAddressDAO = _lateClaimBeneficorAddressDAO;

        prefixStr = _prefixStr;
        deploymentTimestamp = block.timestamp;

        require(_dilute_s1_75_timestamp > block.timestamp, "dilute_s1_75_timestamp must be in future");
        require(_dilute_s2_50_timestamp > _dilute_s1_75_timestamp, "dilute_s2_50_timestamp must be greater than dilute_s1_75_timestamp");
        require(_dilute_s3_0_timestamp > _dilute_s2_50_timestamp, "dilute_s3_0_timestamp must be greater than dilute_s2_50_timestamp");

        dilute_s1_75_timestamp = _dilute_s1_75_timestamp;
        dilute_s2_50_timestamp = _dilute_s2_50_timestamp;
        dilute_s3_0_timestamp = _dilute_s3_0_timestamp;
    }

    function fill(bytes20[] memory _accounts, uint256[] memory _balances) external payable {
        //for simplification we only support a one-shot initialisation.
        require(
            address(this).balance == msg.value,
            "The Claim contract is already filled and cannot get filled a second time."
        );
        require(msg.value > 0, "there must be a value to fill up the ClaimContract");
        require(
            _accounts.length == _balances.length,
            "number of accounts need to match number of balances."
        );

        // we verify if the transfered amount that get added to the sum up to the total amount added.
        uint256 totalBalanceAdded = 0;

        for (uint256 i = 0; i < _accounts.length; ++i) {
            require(_accounts[i] != bytes20(address(0)), "Account cannot be 0x0!");
            require(_balances[i] != 0, "Balance cannot be 0!");
            require(
                balances[_accounts[i]] == 0,
                "Balance is defined multiple times for an account."
            );
            totalBalanceAdded += _balances[i];
            balances[_accounts[i]] = _balances[i];
        }

        require(
            msg.value == totalBalanceAdded,
            "The payment for this function must be equal to the sum of all balances."
        );
    }

    function claim(
        address payable _targetAdress,
        bytes memory _postfix,
        bytes32 _pubKeyX,
        bytes32 _pubKeyY,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        bool _dmdSignature
    ) external {
        //retrieve the oldAddress out of public key.
        bytes20 oldAddress = publicKeyToBitcoinAddress(
            _pubKeyX,
            _pubKeyY
        );

        //if already claimed, it just returns.
        uint256 currentBalance = balances[oldAddress];
        require(currentBalance > 0, "provided address does not have a balance.");

        // verify if the signature matches to the provided pubKey here.
        require(
            claimMessageMatchesSignature(
                _targetAdress,
                _postfix,
                _pubKeyX,
                _pubKeyY,
                _v,
                _r,
                _s,
                _dmdSignature
            ),
            "Signature does not match for this claiming procedure."
        );

        (uint256 nominator, uint256 denominator) = getCurrentDilutedClaimFactor();

        // the nominator is 0 if the claim period passed.
        require(nominator > 0, "claiming period has already passed.");

        uint256 claimBalance = (currentBalance * nominator) / denominator;

        // remember that the funds are going to get claimed, hard protection about reentrancy attacks.
        balances[oldAddress] = 0;
        _targetAdress.transfer(claimBalance);

        emit Claim(oldAddress, _targetAdress, claimBalance, nominator, denominator);
    }

    function addBalance(bytes20 oldAddress) external payable {
        require(
            balances[oldAddress] == 0,
            "There is already a balance defined for this old address"
        );
        balances[oldAddress] = msg.value;
        // allOldAdresses.push(oldAddress);
    }

    /**
     * @dev dilutes the entitlement after a certain time passed away and sends it to the beneficor (reinsert pot)
     * @return amount of DMD that got send to the beneficor.
     */
    function dilute1() external returns (uint256) {
        require(
            block.timestamp > getDilutionTimestamp1(),
            "dilute1 can only get called after the treshold timestamp got reached."
        );
        require(dilution_s1_75_executed == false, "dilute1 event did already happen!");

        dilution_s1_75_executed = true;
        // in dilute 1: after 3 months 25% of the total coins get diluted.

        uint256 totalBalance = (payable(address(this))).balance;
        uint256 dilutionBalance = totalBalance / 4;

        _sendDilutedAmounts(dilutionBalance);

        return dilutionBalance;
    }

    /**
     * @dev dilutes the entitlement after a certain time passed away and sends it to the beneficor (reinsert pot)
     * @return amount of DMD that got send to the beneficor.
     */
    function dilute2() external returns (uint256) {
        require(
            block.timestamp > getDilutionTimestamp2(),
            "dilute2 can only get called after the treshold timestamp got reached."
        );
        require(
            dilution_s1_75_executed == true,
            "dilute2 can't get processed unless dilute1 has already been processed."
        );
        require(dilution_s2_50_executed == false, "dilute2 event did already happen!");

        dilution_s2_50_executed = true;
        // in dilute 1: after 3 months 25% of the total coins get diluted.

        uint256 totalBalance = (payable(address(this))).balance;

        // during dilute2,
        // 25% from dilute1 are already counted away from totalBalance.
        // means 3/4 of the value is still there and we need to get it to 2/4.
        // we can do this by dilluting another 1 / 3.

        uint256 dilutionBalance = totalBalance / 3;

        _sendDilutedAmounts(dilutionBalance);

        return dilutionBalance;
    }

    /**
     * @dev dilutes the entitlement after a certain time passed away and sends it to the beneficor (reinsert pot)
     * @return amount of DMD that got send to the beneficor.
     */
    function dilute3() external returns (uint256) {
        require(
            block.timestamp > getDilutionTimestamp3(),
            "dilute3 can only get called after the treshold timestamp got reached."
        );
        require(
            dilution_s1_75_executed == true,
            "dilute3 can't get processed unless dilute1 has already been processed."
        );
        require(
            dilution_s2_50_executed == true,
            "dilute3 can't get processed unless dilute2 has already been processed."
        );
        require(dilution_s3_0_executed == false, "dilute3 event did already happen!");

        dilution_s1_75_executed = true;
        // in dilute 1: after 3 months 25% of the total coins get diluted.

        uint256 totalBalance = (payable(address(this))).balance;

        // 50% got already diluted. this is the last phase, we dilute the rest.
        _sendDilutedAmounts(totalBalance);

        return totalBalance;
    }

    /**
     * @dev returns the hash for the provided claim target address.
     * @param _claimToAddr address target address for the claim.
     * @return bytes32 Bitcoin hash of the claim message.
     */
    function createClaimMessage(
        address _claimToAddr,
        bytes memory _postfix,
        bool _dmdSignature
    ) public view returns (bytes memory) {
        //TODO: pass this as an argument. evaluate in JS before includeAddrChecksum is used or not.
        //now for testing, we assume Yes.

        bytes memory addrStr = calculateAddressString(_claimToAddr);

        if (_dmdSignature) {
            return
                abi.encodePacked(
                    DIAMOND_SIG_PREFIX_LEN,
                    DIAMOND_SIG_PREFIX_STR,
                    uint8(prefixStr.length) + ETH_ADDRESS_HEX_LEN + 2 + uint8(_postfix.length),
                    prefixStr,
                    addrStr,
                    _postfix
                );
        }
        return
            abi.encodePacked(
                BITCOIN_SIG_PREFIX_LEN,
                BITCOIN_SIG_PREFIX_STR,
                uint8(prefixStr.length) + ETH_ADDRESS_HEX_LEN + 2 + uint8(_postfix.length),
                prefixStr,
                addrStr,
                _postfix
            );
    }

    /**
     * @dev returns the hash for the provided claim target address.
     * @param _claimToAddr address target address for the claim.
     * @return bytes32 DMD style hash of the claim message.
     */
    function getHashForClaimMessage(
        address _claimToAddr,
        bytes memory _postfix,
        bool _dmdSignature
    ) public view returns (bytes32) {
        return calcHash256(createClaimMessage(_claimToAddr, _postfix, _dmdSignature));
    }

    /**
     * @dev returns the ethereum pseude address of a DMD signed message.
     * @param _claimToAddr address target address for the claim.
     * @param _v uint8 v component of the signature.
     * @param _r bytes32 r component of the signature.
     * @param _s bytes32 s component of the signautre.
     * @return address DMD pseudo address of the signer.
     * (what would be the address if the same Private Key would have been used on an DMDv3 than in DMDv4)
     */
    function getEthAddressFromSignature(
        address _claimToAddr,
        bytes memory _postfix,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        bool _dmdSignature
    ) public view returns (address) {
        //require(_v >= 27 && _v <= 30, "v invalid");

        /* Create and hash the claim message text */
        bytes32 messageHash = calcHash256(
            createClaimMessage(_claimToAddr, _postfix, _dmdSignature)
        );

        return ecrecover(messageHash, _v, _r, _s);
    }

    function claimMessageMatchesSignature(
        address _claimToAddr,
        bytes memory _postFix,
        bytes32 _pubKeyX,
        bytes32 _pubKeyY,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        bool _dmdSignature
    ) public view returns (bool) {
        require(_v >= 27 && _v <= 30, "v invalid");

        /*
          ecrecover() returns an Eth address rather than a public key, so
          we must do the same to compare.
      */
        address pubKeyEthAddr = pubKeyToEthAddress(_pubKeyX, _pubKeyY);

        //we need to check if X and Y corresponds to R and S.

        /* Create and hash the claim message text */
        bytes32 messageHash = getHashForClaimMessage(_claimToAddr, _postFix, _dmdSignature);

        /* Verify the public key */
        return ecrecover(messageHash, _v, _r, _s) == pubKeyEthAddr;
    }

    function getDilutionTimestamp1() public view returns (uint256) {
        return dilute_s1_75_timestamp;
    }

    function getDilutionTimestamp2() public view returns (uint256) {
        return dilute_s2_50_timestamp;
    }

    function getDilutionTimestamp3() public view returns (uint256) {
        return dilute_s3_0_timestamp;
    }

    function getCurrentDilutedClaimFactor()
        public
        view
        returns (uint256 nominator, uint256 denominator)
    {
        if (!dilution_s1_75_executed) {
            return (4, 4);
        } else if (!dilution_s2_50_executed) {
            return (3, 4);
        } else if (!dilution_s3_0_executed) {
            return (2, 4);
        } else {
            return (0, 4);
        }
    }

    /// @dev returns the essential part of a Bitcoin-style address associated with an ECDSA public key
    /// @param _publicKeyX X coordinate of the ECDSA public key
    /// @param _publicKeyY Y coordinate of the ECDSA public key
    /// @return rawBtcAddress Raw parts of the Bitcoin Style address
    function publicKeyToBitcoinAddress(
        bytes32 _publicKeyX,
        bytes32 _publicKeyY
    ) public pure returns (bytes20 rawBtcAddress) {

        uint8 initialByte;
        //Hash the compressed format
        initialByte = (uint256(_publicKeyY) & 1) == 0 ? 0x02 : 0x03;
        return ripemd160(
            abi.encodePacked(sha256(abi.encodePacked(initialByte, _publicKeyX)))
        );
    }

    /**
     * @dev PUBLIC FACING: Derive an Ethereum address from an ECDSA public key
     * @param pubKeyX First  half of uncompressed ECDSA public key
     * @param pubKeyY Second half of uncompressed ECDSA public key
     * @return Derived Eth address
     */
    function pubKeyToEthAddress(bytes32 pubKeyX, bytes32 pubKeyY) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(pubKeyX, pubKeyY)))));
    }

    /**
     * @dev sha256(sha256(data))
     * @param data Data to be hashed
     * @return 32-byte hash
     */
    function calcHash256(bytes memory data) public pure returns (bytes32) {
        // NOTE: https://github.com/axic/ethereum-bsm/blob/master/bsm.sol
        // maybe encodePacked is not required ?!
        return sha256(abi.encodePacked(sha256(data)));
    }

    /**
     * @dev calculates the address string representation of the signed address.
     * @param _addr address
     * @return addrStr ethereum address(24 byte)
     */
    function calculateAddressString(
        address _addr
    ) public pure returns (bytes memory addrStr) {
        bytes memory tmp = new bytes(ETH_ADDRESS_HEX_LEN);
        _hexStringFromData(tmp, bytes32(bytes20(_addr)), 0, ETH_ADDRESS_BYTE_LEN);

        bytes32 addrStrHash = keccak256(tmp);
        uint256 offset = 0;

        for (uint256 i = 0; i < ETH_ADDRESS_BYTE_LEN; i++) {
            uint8 b = uint8(addrStrHash[i]);

            _addressStringChecksumChar(tmp, offset++, b >> 4);
            _addressStringChecksumChar(tmp, offset++, b & 0x0f);
        }
    
        // the correct checksum is now in the tmp variable.
        // we extend this by the Ethereum usual prefix 0x

        addrStr = new bytes(ETH_ADDRESS_HEX_LEN + 2);

        addrStr[0] = "0";
        addrStr[1] = "x";

        for (uint256 i = 0; i < ETH_ADDRESS_HEX_LEN; i++) {
            addrStr[i + 2] = tmp[i];
        }

        return addrStr;
    }

    function _sendDilutedAmounts(uint256 amount) internal {
        //diluted amounts are split 50/50 to DAO and ReinsertPot.
        uint256 transferForResinsertPot = amount / 2;
        uint256 transferForDAO = amount - transferForResinsertPot;

        lateClaimBeneficorAddressReinsertPot.transfer(transferForResinsertPot);
        lateClaimBeneficorAddressDAO.transfer(transferForDAO);
    }

    function _hexStringFromData(
        bytes memory hexStr,
        bytes32 data,
        uint256 startOffset,
        uint256 dataLen
    ) private pure {
        uint256 offset = startOffset;

        for (uint256 i = 0; i < dataLen; i++) {
            uint8 b = uint8(data[i]);

            hexStr[offset++] = HEX_DIGITS[b >> 4];
            hexStr[offset++] = HEX_DIGITS[b & 0x0f];
        }
    }

    function _addressStringChecksumChar(
        bytes memory addrStr,
        uint256 offset,
        uint8 hashNybble
    ) private pure {
        bytes1 ch = addrStr[offset];

        if (ch >= "a" && hashNybble >= 8) {
            addrStr[offset] = ch ^ 0x20;
        }
    }
}
