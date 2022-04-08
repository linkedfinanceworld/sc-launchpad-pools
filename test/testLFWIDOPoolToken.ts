import { expect } from "chai";
import { ethers } from "hardhat";

import {Contract, BigNumber, Wallet} from "ethers";
import { formatEther } from "ethers/lib/utils";
import {MockProvider, deployContract} from 'ethereum-waffle';
import {createFixtureLoader} from 'ethereum-waffle';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

describe("LFWIDOPoolToken", function () {

    const provider = new MockProvider();
    const [wallet] = provider.getWallets();

    const loadFixture = createFixtureLoader([wallet], provider);
    const etherUnit = BigNumber.from(10).pow(18);

    async function fixture([wallet]: Wallet[], _mockProvider: MockProvider) {
        const [owner, user1, user2] = await ethers.getSigners();

        const LFWIDOPoolToken = await ethers.getContractFactory("LFWIDOPoolToken");
        const poolToken = await LFWIDOPoolToken.deploy();
        await poolToken.deployed();

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        const tokenLFW = await ERC20Mock.deploy("LFW", "LFW" , owner.address, BigNumber.from(100000).mul(etherUnit));
        await tokenLFW.deployed();

        const ownerTokenBalance = await tokenLFW.balanceOf(owner.address);
        console.log("Amount of LFW that the owner owns: ", formatEther(ownerTokenBalance));

        // console.log("wallet.address: ", wallet.address);
        console.log("lfwToken.address: ", tokenLFW.address);
        console.log("poolToken.address: ", poolToken.address);
        console.log("owner.address: ", owner.address);
        console.log("user.address: ", user1.address);
        console.log("user.address: ", user2.address);

        console.log("initalize LFW Staking Pool");
        const currentBlock = await ethers.provider.getBlockNumber();
        await poolToken.initialize(tokenLFW.address, false, 7, currentBlock, owner.address);

        // have pool an inital amount 1000 LFW tokens
        await tokenLFW.transfer(poolToken.address, BigNumber.from(1000).mul(etherUnit));

        // tokenLFW approve user
        await tokenLFW.connect(user1).approve(poolToken.address, BigNumber.from(100000).mul(etherUnit))
        await tokenLFW.connect(user2).approve(poolToken.address, BigNumber.from(100000).mul(etherUnit))
        // const allowance = await tokenLFW.allowance(user1.address, poolToken.address);
        // console.log("approve poolToken for user with allowance: ", formatEther(allowance));

        // have user own 1000 LFW tokens
        await tokenLFW.transfer(user1.address, BigNumber.from(1000).mul(etherUnit));
        await tokenLFW.transfer(user2.address, BigNumber.from(1000).mul(etherUnit));
        const userTokenBalance1 = await tokenLFW.balanceOf(user1.address);
        const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
        console.log("The amount of LFW that the user1 owns: ", formatEther(userTokenBalance1));
        console.log("The amount of LFW that the user2 owns: ", formatEther(userTokenBalance2));
     
        return {owner, user1, user2, tokenLFW, poolToken};
    }

    let owner: SignerWithAddress
    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let tokenLFW: Contract
    let poolToken: Contract

    beforeEach(async function() {
        const _fixture = await loadFixture(fixture);
        owner = _fixture.owner;
        user1 = _fixture.user1;
        user2 = _fixture.user2;
        tokenLFW = _fixture.tokenLFW;
        poolToken = _fixture.poolToken;
    });

    describe("Testsuite 1 - Verify all fundamental functionalities of Staking Pool", function () {
        it ("normal user fails to reinitalize the pool", async function () {
            const currentBlock = await ethers.provider.getBlockNumber();
            await expect(poolToken.connect(user1).initialize(tokenLFW.address, false, 10, currentBlock, user1.address))
                .to.be.revertedWith("Ownable: caller is not the owner")
        });
    
        it ("owner changes APY sucesfully", async function () {
            await poolToken.changeAPY(10);
            expect(await poolToken.apy()).to.eq(10);
        });
    
        it ("normal user cannot change APY", async function () {
            await expect(poolToken.connect(user1).changeAPY(8)).to.be.revertedWith("Ownable: caller is not the owner");
        });
    
        
        it("user cannot claim if hasn't staked", async function () {       
            await expect(poolToken.connect(user1).claim()).to.be.revertedWith("You do not stake anything");
        });
    
        it("user stakes some LFW tokens, then claims reward", async function () {       
            // console.log("user stakes at the block number ", await ethers.provider.getBlockNumber());
            await expect(poolToken.connect(user1).stake(BigNumber.from(100).mul(etherUnit)))
                .to.emit(poolToken, 'Stake')
                .withArgs(user1.address, BigNumber.from(100).mul(etherUnit));
    
            await ethers.provider.send("hardhat_mine", ["0x15180"]); // block count of 3 days
            // console.log("block number after fast-winding 3 days: ", await ethers.provider.getBlockNumber());
    
            await expect(poolToken.connect(user1).claim())
                .to.emit(poolToken, 'Claim');
        });
    
        it("user cannot unstake before 14 days expired", async function () {
            await expect(poolToken.connect(user1).unStake(BigNumber.from(10).mul(etherUnit)))
                .to.be.revertedWith("Your token is still at the 14-days locked period!");
            
            // simulate fast-winding time
            // here at the momment just before 11 days passed
            await ethers.provider.send("hardhat_mine", ["0x4D57D"]); 
            await expect(poolToken.connect(user1).unStake(BigNumber.from(10).mul(etherUnit)))
                .to.be.revertedWith("Your token is still at the 14-days locked period!");
        });
    
        it("user can unstake right after 14 days succesfully", async function () {
            // fast-winding time
            // here at the momment right after 14 days
            await ethers.provider.send("hardhat_mine", ["0x2"]); // block count of 11 days
            // console.log("block number after fast-winding 14 days: ", await ethers.provider.getBlockNumber());
    
            await expect (poolToken.connect(user1).unStake(BigNumber.from(50).mul(etherUnit)))
                .to.emit(poolToken, 'Claim')
                .to.emit(poolToken, 'Unstake')
                .withArgs(user1.address, BigNumber.from(50).mul(etherUnit));
            
        });
    
        it("failed to unstake a bigger amount than staked LFW tokens", async function () {
            await expect(poolToken.connect(user1).unStake(BigNumber.from(51).mul(etherUnit)))
                .to.be.revertedWith("You did not stake enough to withdraw such amount");
        });
    });

    describe("Testsuite 2 - Monitor balance of users with a chain of actions (Stake, Claim, Unstake)", function () {
        let stakingTime1 = 0; // block Number of the first staking Time
        let unstakingTime1 = 0;
        let stakingTime2 = 0;
        let unstakingTime2 = 0;
        it("user stakes 1000 LFW at day-0", async function () {
            // make sure apy is set to 10
            await poolToken.changeAPY(10);
            expect(await poolToken.apy()).to.eq(10);

            stakingTime1 = await ethers.provider.getBlockNumber();
            console.log("block number when user is staking", stakingTime1);
            
            const userTokenBalance = await tokenLFW.balanceOf(user2.address);
            console.log("Inital amount of LFW that the user owns: ", formatEther(userTokenBalance));

            await expect(poolToken.connect(user2).stake(BigNumber.from(1000).mul(etherUnit)))
                .to.emit(poolToken, 'Stake')
                .withArgs(user2.address, BigNumber.from(1000).mul(etherUnit));

            expect(await tokenLFW.balanceOf(user2.address)).to.equal(BigNumber.from(0).mul(etherUnit))
            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));
        });

        it("user claims reward at day-5", async function () {
            await ethers.provider.send("hardhat_mine", ["0x23280"]); // block count of 5 days
            await expect(poolToken.connect(user2).claim())
                .to.emit(poolToken, 'Claim');
            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));
        });

        it("user claims reward at day-8", async function () {
            await ethers.provider.send("hardhat_mine", ["0x15180"]); // block count of 8-5=3 days
            await expect(poolToken.connect(user2).claim())
                .to.emit(poolToken, 'Claim');
            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));

        });

        it("user cannot unstake LFW at day-13", async function () {
            await ethers.provider.send("hardhat_mine", ["0x23280"]); // block count of 13-8=5 days
            await expect(poolToken.connect(user2).unStake(BigNumber.from(600).mul(etherUnit)))
                .to.be.revertedWith("Your token is still at the 14-days locked period!");

            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));

        });

        it("user unstakes 600 LFW at day-14", async function () {
            await ethers.provider.send("hardhat_mine", ["0x7080"]); // block count of 14-13=1 day

            unstakingTime1 = await ethers.provider.getBlockNumber();
            console.log("block number when user is unstaking", unstakingTime1);

            await expect (poolToken.connect(user2).unStake(BigNumber.from(600).mul(etherUnit)))
                .to.emit(poolToken, 'Claim')
                .to.emit(poolToken, 'Unstake')
                .withArgs(user2.address, BigNumber.from(600).mul(etherUnit));

            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));

            const expectedReward = 1000*0.1*(unstakingTime1-stakingTime1) / 10512000; // number of block in 1 year = 10512000
            
            // this is a work around to compare unstaked token + rewarded token with the balance
            const tmp_value = BigNumber.from(Math.round((600 + expectedReward)*1e8)); 
            const balance = await tokenLFW.balanceOf(user2.address);
            expect(BigNumber.from(balance).div(BigNumber.from(10).pow(10))).to.equal(tmp_value);
        });

        it("user stakes 500 LFW at day-16", async function () {
            await ethers.provider.send("hardhat_mine", ["0xE100"]); // block count of 16-14=2 days

            await expect(poolToken.connect(user2).stake(BigNumber.from(500).mul(etherUnit)))
                .to.emit(poolToken, 'Claim')
                .to.emit(poolToken, 'Stake')
                .withArgs(user2.address, BigNumber.from(500).mul(etherUnit));

            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));
            
        });

        it("user claims reward at day-18", async function () {
            await ethers.provider.send("hardhat_mine", ["0xE100"]); // block count of 18-16=2 days

            await expect(poolToken.connect(user2).claim())
                .to.emit(poolToken, 'Claim');

            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));
            
        });

        it("user cannot unstake LFW at day-29", async function () {
            await ethers.provider.send("hardhat_mine", ["0x4D580"]); // block count of 29-18=11 days
            await expect(poolToken.connect(user2).unStake(BigNumber.from(600).mul(etherUnit)))
                .to.be.revertedWith("Your token is still at the 14-days locked period!");

        });

        it("user unstakes 900 LFW at day-30", async function () {
            await ethers.provider.send("hardhat_mine", ["0x7080"]); // block count of 30-29=1 day

            await expect (poolToken.connect(user2).unStake(BigNumber.from(900).mul(etherUnit)))
                .to.emit(poolToken, 'Claim')
                .to.emit(poolToken, 'Unstake')
                .withArgs(user2.address, BigNumber.from(900).mul(etherUnit));

            const userTokenBalance2 = await tokenLFW.balanceOf(user2.address);
            console.log("The amount of LFW that the user owns: ", formatEther(userTokenBalance2));

            console.log("roughly, reward = 1000*0.1*14/365 + 400*0.1*2/365 + 900*0.1*14/365 = 7.50684931507");
        });
    });

});
