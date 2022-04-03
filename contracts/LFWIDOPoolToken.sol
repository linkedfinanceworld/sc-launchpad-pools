// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol"; 
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"; 
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

contract LFWIDOPoolToken is 
        Context,
        Ownable,
        ReentrancyGuard, 
        ERC20("LFW-IDO-Pool-Token", "LFW-IDO-Token") 
{

    using SafeERC20 for IERC20;
    using SafeMath for uint256;


    event Stake(address indexed wallet, uint256 amount);
    event Unstake(address indexed user, uint256 amount);
    event Claimed(address indexed wallet, uint256 amount);
    event ChangeAPYvalue(uint256 amount);

    // 30 days to block
    uint256 internal constant BLOCK_COUNT_IN_14_DAYS = 403200;

    // 1 year block to calculate apy
    uint256 internal constant BLOCK_COUNT_IN_1_YEAR = 10512000;

    // Whether it is initialized
    bool internal isInitialized;

    // Whether the pool's staked token balance can be removed by owner
    bool private isRemovable;

    // The staked token
    ERC20 public stakedToken;

    // APY
    uint256 public apy;

    // Info of each user that stakes tokens (stakedToken)
    mapping(address => UserInfo) internal userInfo;
    
    // user list
    address[] internal userList;

    struct UserInfo {
        uint256 stakingTime;
        uint256 lockTime;
        uint256 lastClaimingTime;
        uint256 stakedAmount;
    }

    /*
     * @notice Initialize the contract
     * @param _stakedToken: staked token address
     * @param _isRemovable: whether the pool is removed or not (should set to false at the beginning)
     * @param apy_: staking pool APY
     * @param _admin: admin address with ownership
     */
    function initialize(
        ERC20 _stakedToken,
        bool _isRemovable,
        uint256 apy_,
        address _admin
    ) external {
        require(!isInitialized, "Already initialized");
        require(msg.sender == LFW_CASTLE_FACTORY, "Not factory");

        require(address(_stakedToken) != address(0), "Invalid address");
        require(address(_admin) != address(0), "Invalid address");

        // Make this contract initialized
        isInitialized = true;
        stakedToken = _stakedToken;
        isRemovable = _isRemovable;
        apy = apy_;
        // Transfer ownership to the admin address who becomes owner of the contract
        transferOwnership(_admin);
    }

    /*
     * @notice calculate the pending reward of user
     * @param _user: user address
     */    
    function pendingReward(address _usr) internal returns (uint256) {
        UserInfo storage user = userInfo[_usr];
        uint256 currentBlock = block.number;
        uint256 timePeriod;
        // if user has claimed, then timePeriod is count from the last time user claimed
        if (user.lastClaimingTime != 0) {
            timePeriod = currentBlock.sub(user.lastClaimingTime);
            user.lastClaimingTime = currentBlock;
        } else {
            timePeriod = currentBlock.sub(user.stakingTime);
        }
        uint256 numerator = user.stakedAmount.mul(apy).div(100);
        uint256 var_ = numerator.div(BLOCK_COUNT_IN_1_YEAR);
        uint256 userTotalReward = var_.mul(timePeriod);
        return userTotalReward;
    }

    /*
     * @notice stake/deposit LFW in the pool
     * @param _amount: amount to stake
     */    
    function stake(uint256 _amount) external nonReentrant {
        require(!isRemovable, "Pool has been removed");
        require(_amount > 0, "Negative value is prohibited");
        UserInfo storage user = userInfo[msg.sender];

        // Push address in list
        if (user.stakedAmount == 0) {
            userList.push(address(msg.sender));
        }

        // Receive old reward first to recalculate new reward
        if (user.stakedAmount > 0) {
            uint256 pending = pendingReward(address(msg.sender));
            ERC20(stakedToken).transfer(
                address(msg.sender),
                pending
            );
        }

        // Stake token 
        if (_amount > 0) {
            user.stakedAmount = user.stakedAmount.add(_amount);
            IERC20(stakedToken).transferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
        }

        // Update user time variables
        uint256 currentBlock = block.number;
        user.stakingTime = currentBlock;
        user.lockTime = currentBlock.add(BLOCK_COUNT_IN_14_DAYS); 
        emit Stake(address(msg.sender), _amount);
    }


    /*
     * @notice unstake LFW
     * @param _amount: amount to unstake
     */    
    function unStake(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        require(
            user.stakedAmount >= _amount, 
            "You do not stake enough to withdraw such amount"
        );
        require(
            user.lockTime < block.number,
            "Your token is still at the 14-days locked period!"
        );

        // Receive old reward first to recalculate new reward
        if (user.stakedAmount > 0) {
            uint256 pending = pendingReward(address(msg.sender));
            ERC20(stakedToken).transfer(
                address(msg.sender),
                pending
            );
        }

        // Transfer LFW to user
        ERC20(stakedToken).transfer(address(msg.sender), _amount);
        user.stakedAmount = user.stakedAmount.sub(_amount);

        emit Unstake(address(msg.sender), _amount);
    }

    /*
     * @notice claim LFW reward
     */       
    function claim() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        require(
            user.stakedAmount > 0, 
            "You do not stake anything"
        );

        uint256 pending = pendingReward(address(msg.sender));
        ERC20(stakedToken).transfer(address(msg.sender), pending);
        emit Claimed(address(msg.sender), pending);
    }

    function safeERC20Transfer(
        ERC20 erc20,
        address _to,
        uint256 _amount
    ) private {
        uint256 balance = erc20.balanceOf(address(this));
        if (_amount > balance) {
            erc20.transfer(_to, balance);
        } else {
            erc20.transfer(_to, _amount);
        }
    }

    /*
     * @notice claim LFW reward
     * @param apy_: new APY
     */       
    function changeAPY(uint256 _apy) external onlyOwner {
        apy = _apy;
        emit ChangeAPYvalue(_apy);
    }

    /*
     * @notice claim LFW reward
     * @param apy_: new APY
     */       
    function setRemovePool(bool _remove) external onlyOwner {
        isRemovable = _remove; 
    }

    /*
     * @notice Withdraw staked tokens without caring about rewards rewards
     * @dev Needs to be for emergency.
     */
    function emergencyWithdraw(uint256 _amount) external onlyOwner {
        ERC20(stakedToken).transfer(address(msg.sender), _amount);
    }

}