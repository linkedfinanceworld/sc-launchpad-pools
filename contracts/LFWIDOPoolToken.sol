// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol"; 
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
    using SafeMath for uint256;

    event Stake(address indexed wallet, uint256 amount);
    event Unstake(address indexed user, uint256 amount);
    event Claim(address indexed wallet, uint256 amount);
    event ChangeApyValue(uint256 amount);

    // 14 days to block
    uint256 internal constant BLOCK_COUNT_IN_14_DAYS = 403200;

    // FIXME this is for testing on staging
    // remove this when going on production
    // uint256 internal constant BLOCK_COUNT_IN_14_DAYS = 40; //2 minutes

    // 1 year block to calculate apy
    uint256 internal constant BLOCK_COUNT_IN_1_YEAR = 10512000;

    // Whether it is initialized
    bool internal isInitialized;

    // Whether the pool's staked token balance can be removed by owner
    bool public isPoolClosed;

    // The staked token
    ERC20 public stakedToken;

    // The block number when the pool is opened
    uint256 public startBlock;

    // The block number when the pool is closed (artificial one for FE)
    uint256 public endBlock = 100000000000; // as big as possible

    // APY
    uint256 public apy;

    // Info of each user that stakes tokens (stakedToken)
    mapping(address => UserInfo) public userInfo;
    
    // user list
    address[] public userList;

    struct UserInfo {
        uint256 stakingTime;
        uint256 lockTime;
        uint256 lockTimeStamp;
        uint256 lastClaimingTime;
        uint256 stakedAmount;
    }

    /*
     * @notice Initialize the contract
     * @param _stakedToken: staked token address
     * @param _isPoolClosed: whether the pool is closed or not (should set to false at the beginning)
     * @param _apy: staking pool APY
     * @param _startBlock: the block number when the pool is opened
     * @param _admin: admin address with ownership
     */
    function initialize(
        ERC20 _stakedToken,
        bool _isPoolClosed,
        uint256 _apy,
        uint256 _startBlock,
        address _admin
    ) external onlyOwner {
        require(!isInitialized, "Already initialized");
        require(address(_stakedToken) != address(0), "Invalid address");
        require(address(_admin) != address(0), "Invalid address");

        // Make this contract initialized
        isInitialized = true;
        stakedToken = _stakedToken;
        isPoolClosed = _isPoolClosed;
        apy = _apy;
        startBlock = _startBlock;
        // Transfer ownership to the admin address who becomes owner of the contract
        transferOwnership(_admin);
    }

    /*
     * @notice calculate the pending reward of user up till a cerntain time
     * @param userAddress: the address of user who are receiving reward
     * @param blockNumber: the block number as the point for reward calculation
     */    
    function calculateReward(address userAddress) public view returns (uint256) {
        uint256 blockNumber = block.number;
        UserInfo storage user = userInfo[userAddress];
        uint256 stakingPeriod;
        
        if (user.lastClaimingTime != 0) {
            // if user has claimed, then staking period counts from the last time user claimed
            stakingPeriod = blockNumber.sub(user.lastClaimingTime);
        } else {
            // if user hasn't claimed, then staking period counts from the time user staked
            stakingPeriod = blockNumber.sub(user.stakingTime);
        }

        uint256 rewardIn1Year = user.stakedAmount.mul(apy).div(100);
        uint256 rewardInStakingPeriod = rewardIn1Year.mul(stakingPeriod).div(BLOCK_COUNT_IN_1_YEAR);
        return rewardInStakingPeriod;
    }

    function userClaimReward(address userAddress) internal returns (uint256) {
        UserInfo storage user = userInfo[userAddress];
        uint256 reward = calculateReward(userAddress);
        user.lastClaimingTime = block.number;
        ERC20(stakedToken).transfer(userAddress, reward);
        return reward;
    }

    /*
     * @notice stake/deposit LFW in the pool
     * @param _amount: the amount of token that user stakes
     */    
    function stake(uint256 _amount) external nonReentrant {
        uint256 currentBlock = block.number;
        
        require(!isPoolClosed, "Pool has been closed");
        require(startBlock <= currentBlock, "Pool is not started yet");
        require(_amount > 0, "Negative value is prohibited");

        UserInfo storage user = userInfo[msg.sender];

        // Push address in list
        if (user.stakingTime == 0) {
            userList.push(address(msg.sender));
        }

        // Receive old reward first to recalculate new reward
        if (user.stakedAmount > 0) {
            uint256 reward = userClaimReward(address(msg.sender));
            emit Claim(address(msg.sender), reward);
        }

        // Stake token 
        if (_amount > 0) {
            user.stakedAmount = user.stakedAmount.add(_amount);
            IERC20(stakedToken).transferFrom(address(msg.sender), address(this), _amount);
        }

        // Update user time variables
        user.stakingTime = currentBlock;
        user.lockTime = currentBlock.add(BLOCK_COUNT_IN_14_DAYS); 
        user.lockTimeStamp = block.timestamp + 14 days;
        emit Stake(address(msg.sender), _amount);
    }


    /*
     * @notice unstake LFW
     * @param _amount: amount to unstake
     */    
    function unStake(uint256 _amount) external nonReentrant {
        uint256 currentBlock = block.number;
        UserInfo storage user = userInfo[msg.sender];
        require(_amount <= user.stakedAmount,
            "You did not stake enough to withdraw such amount"
        );
        require(user.lockTime <= currentBlock,
            "Your token is still at the 14-days locked period!"
        );

        // Receive old reward first to recalculate new reward
        if (user.stakedAmount > 0) {
            uint256 reward = userClaimReward(address(msg.sender));
            emit Claim(address(msg.sender), reward);
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
        require(user.stakedAmount > 0, "You did not stake anything");

        uint256 reward = userClaimReward(address(msg.sender));
        emit Claim(address(msg.sender), reward);
    }

    /*
     * @notice change apy
     * @param apy_: new APY
     */       
    function changeAPY(uint256 _apy) external onlyOwner {
        apy = _apy;
        emit ChangeApyValue(_apy);
    }

    /*
     * @notice used to close pool if needed
     */       
    function setPoolClosed(bool _isPoolClosed) external onlyOwner {
        isPoolClosed = _isPoolClosed; 
    }

    // function for FE
    function viewCountDown(address _usr) public view returns(uint256) {
        UserInfo storage user = userInfo[_usr];
        uint256 currentBlock = block.number;
        uint256 remainingBlocksTillUnlock;
        if (user.stakedAmount == 0) {
            remainingBlocksTillUnlock = 0;
        } else {
            if (currentBlock < user.lockTime) {
                remainingBlocksTillUnlock = user.lockTime - currentBlock;
            } else {
                remainingBlocksTillUnlock = 0;
            }
        }
        return remainingBlocksTillUnlock;
    }


    /*
     * @notice total of tokens in pool (this is different to total of tokens that staked by users)
     */
    function totalSupply() public view override returns (uint256) {
        return stakedToken.balanceOf(address(this));
    }


    /*
     * @notice total amount of tokens that have been staked by users
     */
    function totalStakedAmount() public view onlyOwner returns (uint256) {
        uint256 numberOfUsers = userList.length;
        uint256 total = 0;
        for (uint256 i = 0; i < numberOfUsers; i++) {
            total += userInfo[userList[i]].stakedAmount;
        }
        return total;
    }


    /*
     * @notice total amount of tokens (in Ether unit) that have been staked by users
     */
    function totalStakedAmountInEther() external view onlyOwner returns (uint256) {
        uint256 total = totalStakedAmount();
        return total.div(1 ether);
    }

    /*
     * @notice return total of tokens in pool that have been staked by all users
     */
    function totalUsers() public view returns (uint256) {
        return userList.length;
    }


    /*
     * @notice Withdraw staked tokens without caring about rewards rewards
     * @dev Needs to be for emergency.
     */
    function emergencyWithdraw(uint256 _amount) external onlyOwner {
        ERC20(stakedToken).transfer(address(msg.sender), _amount);
    }

}