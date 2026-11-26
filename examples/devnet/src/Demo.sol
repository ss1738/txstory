// SPDX-License-Identifier: Apache-2.0
// Contracts for TxStory's local devnet integration tests (anvil). Not for production use.
pragma solidity 0.8.30;

contract Reverter {
    event Received(address from, uint256 value);

    function receiveAndRevert() external payable {
        emit Received(msg.sender, msg.value); // rolled back with the call
        revert("nope");
    }
}

contract DemoToken {
    event Transfer(address indexed from, address indexed to, uint256 value);
    mapping(address => uint256) public balanceOf;

    constructor() { balanceOf[msg.sender] = 1_000_000e18; emit Transfer(address(0), msg.sender, 1_000_000e18); }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
}

contract Vault {
    error InsufficientBalance(uint256 available, uint256 required);
    event Split(address indexed a, address indexed b, uint256 each);
    event Attempt(address indexed target, bool ok);

    Reverter public immutable reverter;

    constructor(Reverter r) { reverter = r; }

    /// Nested native transfers: half to each recipient.
    function split(address payable a, address payable b) external payable {
        uint256 each = msg.value / 2;
        (bool ok1, ) = a.call{value: each}("");
        (bool ok2, ) = b.call{value: msg.value - each}("");
        require(ok1 && ok2, "send failed");
        emit Split(a, b, each);
    }

    /// One transfer that sticks and one that is rolled back inside a caught failure.
    function payAndTry(address payable good) external payable {
        (bool ok1, ) = good.call{value: msg.value / 2}("");
        require(ok1, "send failed");
        try reverter.receiveAndRevert{value: msg.value / 2}() {
            emit Attempt(address(reverter), true);
        } catch {
            emit Attempt(address(reverter), false);
        }
    }

    function withdrawTooMuch(uint256 required) external view {
        revert InsufficientBalance(address(this).balance, required);
    }

    function boom() external pure {
        require(false, "boom: not allowed");
    }

    function overflow(uint8 x) external pure returns (uint8) {
        return x + 250; // panics for x > 5
    }
}
