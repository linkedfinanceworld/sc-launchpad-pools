import { expect } from "chai";
import { ethers } from "hardhat";
import { network } from "hardhat";

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
        const [owner, user] = await ethers.getSigners();

        const LFWIDOPoolToken = await ethers.getContractFactory("LFWIDOPoolToken");
        const poolToken = await LFWIDOPoolToken.deploy();
        await poolToken.deployed();

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        const tokenLFW = await ERC20Mock.deploy("LFW", "LFW" , owner.address, BigNumber.from(100000).mul(etherUnit));
        await tokenLFW.deployed();

        const ownerTokenBalance = await tokenLFW.balanceOf(owner.address);
        console.log("Amount of LFW that the owner owns: ", formatEther(ownerTokenBalance));

        console.log("wallet.address: ", wallet.address);
        console.log("lfwToken.address: ", tokenLFW.address);
        console.log("poolToken.address: ", poolToken.address);
        console.log("owner.address: ", owner.address);
        console.log("user.address: ", user.address);

        console.log("initalize LFW Staking Pool");
        await poolToken.initialize(tokenLFW.address, false, 7, owner.address);

        // have pool an inital amount 1000 LFW tokens
        await tokenLFW.transfer(poolToken.address, BigNumber.from(1000).mul(etherUnit));

        console.log("approve poolToken");
        tokenLFW.connect(user).approve(poolToken.address, BigNumber.from(100000).mul(etherUnit))

        // have user own 1000 LFW tokens
        await tokenLFW.transfer(user.address, BigNumber.from(1000).mul(etherUnit));
        const userTokenBalance = await tokenLFW.balanceOf(user.address);
        console.log("Amount of LFW that the user owns: ", formatEther(userTokenBalance));
     
        return {owner, user, tokenLFW, poolToken};
    }

    let owner: SignerWithAddress
    let user: SignerWithAddress
    let tokenLFW: Contract
    let poolToken: Contract

    beforeEach(async function() {
        const _fixture = await loadFixture(fixture);
        owner = _fixture.owner;
        user = _fixture.user;
        tokenLFW = _fixture.tokenLFW;
        poolToken = _fixture.poolToken;
    });

    it ("normal user fails to reinitalize the pool", async function () {
        await expect(poolToken.connect(user).initialize(tokenLFW.address, false, 10, user.address))
            .to.be.revertedWith("Ownable: caller is not the owner")
    });

    it ("owner changes APY sucesfully", async function () {
        await poolToken.changeAPY(8);
        expect(await poolToken.apy()).to.eq(8);
    });

    it ("normal user cannot change APY", async function () {
        await expect(poolToken.connect(user).changeAPY(8)).to.be.revertedWith("Ownable: caller is not the owner");
    });

    
    it("fail to claim when user hasn't staked", async function () {       
        await expect(poolToken.connect(user).claim()).to.be.revertedWith("You do not stake anything");
    });

    it("user stakes & claim", async function () {       
        // user stake some tokens
        const allowance = await tokenLFW.allowance(user.address, poolToken.address);
        console.log("allowance: ", formatEther(allowance));

        const userTokenBalance = await tokenLFW.balanceOf(user.address);
        console.log("Amount of LFW that the user owns: ", formatEther(userTokenBalance));
        console.log("user stakes some tokens");
        await expect(poolToken.connect(user).stake(BigNumber.from(100).mul(etherUnit)))
            .to.emit(poolToken, 'Stake')
            .withArgs(user.address, BigNumber.from(100).mul(etherUnit));

        const userTokenBalance1 = await tokenLFW.balanceOf(user.address);
        console.log("Amount of LFW that the user owns: ", formatEther(userTokenBalance1));

        console.log("block number before fast-winding 3 days: ", await ethers.provider.getBlockNumber());
        await ethers.provider.send("hardhat_mine", ["0x15180"]); // block count of 3 days
        console.log("block number after fast-winding 3 days: ", await ethers.provider.getBlockNumber());

        console.log("user claims reward");
        await expect(await poolToken.connect(user).claim())
            .to.emit(poolToken, 'Claimed');
        
        const userTokenBalance2 = await tokenLFW.balanceOf(user.address);
        console.log("Amount of LFW that the user owns after claim: ", formatEther(userTokenBalance2));
        expect (userTokenBalance2).to.gt(userTokenBalance1);

    });

    it("fail to unstake before 14 days expired", async function () {
        const userTokenBalance = await tokenLFW.balanceOf(user.address);
        console.log("Amount of LFW that the user owns: ", formatEther(userTokenBalance));
        await expect(poolToken.connect(user).unStake(BigNumber.from(10).mul(etherUnit)))
            .to.be.revertedWith("Your token is still at the 14-days locked period!");
    });

    it("unstake after 14 days succesfully", async function () {
        console.log("block before fast-winding 30days: ", await ethers.provider.getBlockNumber());
        await ethers.provider.send("hardhat_mine", ["0xD2F00"]); // block count of 30 days
        console.log("block after fast-winding 30days: ", await ethers.provider.getBlockNumber());

        const userTokenBalance = await tokenLFW.balanceOf(user.address);
        console.log("Amount of LFW that the user owns: ", formatEther(userTokenBalance));
        await poolToken.connect(user).unStake(BigNumber.from(100).mul(etherUnit))
        const userTokenBalance1 = await tokenLFW.balanceOf(user.address);
        console.log("Amount of LFW that the user owns: ", formatEther(userTokenBalance1));
    });

    it("failed to unstake bigger staked amount", async function () {
        await expect(poolToken.connect(user).unStake(BigNumber.from(1000).mul(etherUnit)))
            .to.be.revertedWith("You do not stake enough to withdraw such amount");
    });

});
